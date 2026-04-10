import { redirect } from "next/navigation";

import { getConversation, getMessages, getConversationParticipants } from "@/lib/messaging/queries";
import { createServerClient } from "@/lib/supabase/server";
import { markAsRead } from "@/lib/messaging/actions";

import { ConversationView } from "./conversation-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const conversation = await getConversation(conversationId);
  return {
    title: conversation?.subject
      ? `${conversation.subject} - Messages`
      : "Conversation - Messages",
  };
}

export default async function ProviderConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const [conversation, { messages }, participants] = await Promise.all([
    getConversation(conversationId),
    getMessages(conversationId, { limit: 50 }),
    getConversationParticipants(conversationId),
  ]);

  if (!conversation) {
    redirect("/provider/messages");
  }

  // Mark as read on view
  await markAsRead(conversationId);

  const otherParticipants = participants.filter(
    (p) => p.profile_id !== user.id,
  );
  const conversationTitle =
    conversation.subject ??
    otherParticipants
      .map((p) => p.display_name ?? "Care receiver")
      .join(", ");

  return (
    <ConversationView
      conversationId={conversationId}
      conversationTitle={conversationTitle}
      initialMessages={messages}
      participants={participants}
      currentUserId={user.id}
      backHref="/provider/messages"
    />
  );
}
