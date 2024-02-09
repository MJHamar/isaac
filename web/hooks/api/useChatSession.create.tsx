import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@utils/supabase';
import mixpanel from 'mixpanel-browser';
import { toast } from 'sonner';
import { ChatSession, ChatSessionType } from 'types/chat';

const createChatSession = async ({
	projectId,
	title,
	type = 'CONVERSATION',
}: {
	projectId: string;
	type?: ChatSessionType;
	title?: string;
}) => {
	const { data } = await supabase
		.from('chat_sessions')
		.insert([
			{
				project_id: projectId,
				title: title,
				type,
			},
		])
		.select()
		.single();

	return data;
};

const useCreateChatSession = (params?: {
	onSuccessCb?: (chatSession: ChatSession) => void;
}) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (payload: { projectId: string; title: string }) =>
			createChatSession({ ...payload }),
		mutationKey: ['create-chat-session'],
		onMutate: () => {
			mixpanel.track('Created ChatSession');
		},
		onSuccess: chatSession => {
			if (params?.onSuccessCb) {
				params.onSuccessCb(chatSession);
			}

			queryClient.invalidateQueries({ queryKey: ['get-chat-sessions'] });
		},
		onError: error => {
			console.log({ error });
			toast.error('There is something wrong. Please try again.');
		},
	});
};

export default useCreateChatSession;
