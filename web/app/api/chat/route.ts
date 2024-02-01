// import fetch from 'node-fetch';
import { updateTokenUsageForFreeTier } from '@resources/updateTokenUsageForFreeTier';
import { OpenAIStream, StreamingTextResponse } from 'ai';
import { AIModels } from 'data/aiModels.data';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { ChatContext } from 'types/chat';

const encoder = new TextEncoder();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Function to create and return a custom readable stream
function createCustomReadableStream() {
	let controller;
	// Create a stream
	const customReadable = new ReadableStream({
		start(_controller) {
			controller = _controller;
			// Initial data, if any
			// controller.enqueue(encoder.encode("data: ok\n\n"));
		},
	});
	return { stream: customReadable, controller };
}

export const runtime = 'edge';

type Payload = {
	userId: string;
	context: ChatContext;
	messages: any;
	max_tokens: number;
	projectId: string;
	uploadId: string;
	temperature: number;
	llmModel?: any;
};

const singleReferenceEndpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/retrieve-single-reference-embeddings`;
const projectReferenceEndpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/retrieve-reference-embeddings`;
const realtimeEndpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/search-web`;

export async function POST(req: Request) {
	try {
		const {
			userId,
			messages,
			max_tokens,
			temperature,
			projectId,
			uploadId,
			context,
			llmModel: bodyLLMModel,
		} = (await req.json()) as Payload;

		let llmModel = bodyLLMModel;

		const user = await updateTokenUsageForFreeTier(userId);

		if (user.message != 'success') {
			llmModel = AIModels.GPT_3_5;
		}

		let prompt = '';
		if (context === 'references' || context === 'realtime') {
			prompt = messages.pop().content;
		}

		if (context === 'references') {
			const body = uploadId ? { prompt, uploadId } : { prompt, projectId };

			const res = await fetch(
				uploadId ? singleReferenceEndpoint : projectReferenceEndpoint,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(body),
				},
			);

			if (!res.ok) {
				throw new Error(
					`Failed to fetch from reference endpoint: ${res.statusText}`,
				);
			}

			const injectedDoc = await res.json();
			messages.push({
				role: 'user',
				content: `${prompt}\n Document: ${injectedDoc}`,
			});
		}

		if (context === 'realtime') {
			const currentDate = new Date();
			const dateString = currentDate.toString();

			const res = await fetch(realtimeEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					query: prompt,
				}),
			});

			if (!res.ok) {
				throw new Error(
					`Failed to fetch from realtime endpoint: ${res.statusText}`,
				);
			}

			const realtimeContext = await res.json();
			messages.push({
				role: 'user',
				content: `Web search results:\n\n ${JSON.stringify(
					realtimeContext,
				)}\nCurrent date:${dateString}\n\nInstructions:Using the provided web search results, write a comprehensive reply to the given query. Make sure to cite results using [[number](URL)] notation after the reference. If the provided search results refer to multiple subjects with the same name, write separate answers for each subject.\nQuery:${prompt} `,
			});
		}

		const completion = await openai.chat.completions.create({
			model: llmModel || 'gpt-3.5-turbo',
			messages,
			temperature,
			max_tokens,
			top_p: 1,
			stream: true,
		});

		const { stream, controller } = createCustomReadableStream();

		for await (const chunk of completion) {
			// Forward the data from the completion request to the client
			if (
				controller &&
				chunk.choices[0]?.delta?.content &&
				chunk.choices[0].delta.content.trim() !== ''
			) {
				controller.enqueue(
					encoder.encode(
						`data: ${Buffer.from(chunk.choices[0].delta.content).toString(
							'base64',
						)}\n\n`,
					),
				);
			}
		}

		// Send a final chunk to the frontend that says [DONE]
		if (controller) {
			controller.enqueue(
				encoder.encode(`data: ${Buffer.from('[DONE]').toString('base64')}\n\n`),
			);
		}

		// Close the SSE connection when the completion request is complete
		if (controller) {
			controller.close();
		}
		// Return the stream and try to keep the connection alive
		return new Response(stream, {
			// Set headers for Server-Sent Events (SSE) / stream from the server
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				Connection: 'keep-alive',
				'Cache-Control': 'no-cache, no-transform',
				'Content-Encoding': 'none',
			},
		});
	} catch (error) {
		console.error(error);
		return new Response(
			JSON.stringify({
				error: 'An error occurred while processing your request.',
			}),
			{
				status: 500,
				headers: {
					'Content-Type': 'application/json',
				},
			},
		);
	}
}
