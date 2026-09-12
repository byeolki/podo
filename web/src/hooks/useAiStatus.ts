import { useQuery } from '@tanstack/react-query'
import { getChatStatus } from '../api/admin'

/**
 * Whether the AI features can do anything, for every button that triggers one.
 *
 * They used to each decide for themselves: the track editor asked an admin-only
 * endpoint (so it stayed enabled for exactly the non-admins it was meant to
 * stop), and the library's bulk fill asked nothing at all. One query, one answer.
 */
export function useAiStatus() {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-chat-status'],
    queryFn: getChatStatus,
    staleTime: 5 * 60_000,
    retry: false,
  })

  return {
    // Assume unavailable until told otherwise, so a button never flickers
    // enabled and then refuses.
    available: data?.available ?? false,
    chatEnabled: data?.chat_enabled ?? false,
    isLoading,
    reason: data?.available ? null : 'No AI provider is configured — see Settings → AI',
  }
}
