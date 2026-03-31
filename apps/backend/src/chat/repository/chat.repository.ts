import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '@/common';
import { ChatRoom, ChatRoomMember, ChatMessage, ChatJoinRequest } from '@/chat/domain';
import { ChatRoomMemberRole, ChatJoinRequestStatus } from '@homerunnie/shared';
import { Member } from '@/member/domain/member.entity';
import { Profile } from '@/member/domain/profile.entity';
import { Post } from '@/post/domain';
import { RecruitmentDetail } from '@/post/domain/recruitment-detail.entity';
import * as schema from '@/common/db/schema';

type ChatRoomType = typeof ChatRoom.$inferSelect;
type ChatRoomMemberType = typeof ChatRoomMember.$inferSelect;
type DbType = NodePgDatabase<typeof schema>;
type DbTransaction = Parameters<Parameters<DbType['transaction']>[0]>[0];

@Injectable()
export class ChatRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: DbType,
  ) {}

  async createChatRoom(postId: number, tx?: DbTransaction): Promise<ChatRoomType> {
    const executor = tx || this.db;
    const [chatRoom] = await executor.insert(ChatRoom).values({ postId }).returning();

    return chatRoom;
  }

  async createChatRoomMember(
    chatRoomId: number,
    memberId: number,
    role: ChatRoomMemberRole,
    tx?: DbTransaction,
  ): Promise<ChatRoomMemberType> {
    const executor = tx || this.db;
    const [member] = await executor
      .insert(ChatRoomMember)
      .values({ chatRoomId, memberId, role })
      .returning();

    return member;
  }

  async findChatRoomsByMemberId(memberId: number, page: number, limit: number) {
    const offset = (page - 1) * limit;

    const chatRooms = await this.db
      .select({
        id: ChatRoom.id,
        postId: ChatRoom.postId,
        postTitle: Post.title,
        createdAt: ChatRoom.createdAt,
        updatedAt: ChatRoom.updatedAt,
        deleted: ChatRoom.deleted,
        role: ChatRoomMember.role,
        teamHome: RecruitmentDetail.teamHome,
        teamAway: RecruitmentDetail.teamAway,
        gameDate: RecruitmentDetail.gameDate,
        lastMessage: sql<string | null>`(
          SELECT ${ChatMessage.content} FROM ${ChatMessage}
          WHERE ${ChatMessage.chatRoomId} = ${ChatRoom.id}
          ORDER BY ${ChatMessage.createdAt} DESC
          LIMIT 1
        )`.as('last_message'),
        lastMessageAt: sql<Date | null>`(
          SELECT ${ChatMessage.createdAt} FROM ${ChatMessage}
          WHERE ${ChatMessage.chatRoomId} = ${ChatRoom.id}
          ORDER BY ${ChatMessage.createdAt} DESC
          LIMIT 1
        )`.as('last_message_at'),
        unreadCount: sql<number>`(
          SELECT COUNT(*) FROM ${ChatMessage}
          WHERE ${ChatMessage.chatRoomId} = ${ChatRoom.id}
          AND ${ChatMessage.createdAt} > ${ChatRoomMember.lastReadAt}
          AND ${ChatMessage.senderId} != ${ChatRoomMember.memberId}
        )`.as('unread_count'),
      })
      .from(ChatRoom)
      .innerJoin(ChatRoomMember, eq(ChatRoom.id, ChatRoomMember.chatRoomId))
      .leftJoin(Post, eq(ChatRoom.postId, Post.id))
      .leftJoin(RecruitmentDetail, eq(Post.id, RecruitmentDetail.postId))
      .where(
        and(
          eq(ChatRoomMember.memberId, memberId),
          eq(ChatRoom.deleted, false),
          eq(ChatRoomMember.deleted, false),
        ),
      )
      .orderBy(
        sql`COALESCE((
          SELECT ${ChatMessage.createdAt} FROM ${ChatMessage}
          WHERE ${ChatMessage.chatRoomId} = ${ChatRoom.id}
          ORDER BY ${ChatMessage.createdAt} DESC
          LIMIT 1
        ), ${ChatRoom.updatedAt}) DESC`,
      )
      .limit(limit)
      .offset(offset);

    return chatRooms;
  }

  async countChatRoomsByMemberId(memberId: number): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(ChatRoom)
      .innerJoin(ChatRoomMember, eq(ChatRoom.id, ChatRoomMember.chatRoomId))
      .where(
        and(
          eq(ChatRoomMember.memberId, memberId),
          eq(ChatRoom.deleted, false),
          eq(ChatRoomMember.deleted, false),
        ),
      );

    return result[0]?.count || 0;
  }

  async findChatRoomByPostId(postId: number): Promise<ChatRoomType | null> {
    const [chatRoom] = await this.db
      .select()
      .from(ChatRoom)
      .where(and(eq(ChatRoom.postId, postId), eq(ChatRoom.deleted, false)));

    return chatRoom || null;
  }

  async findChatRoomById(chatRoomId: number): Promise<ChatRoomType | null> {
    const [chatRoom] = await this.db
      .select()
      .from(ChatRoom)
      .where(and(eq(ChatRoom.id, chatRoomId), eq(ChatRoom.deleted, false)));

    return chatRoom || null;
  }

  async findPostStatusByChatRoomId(chatRoomId: number): Promise<string | null> {
    const [result] = await this.db
      .select({ postStatus: Post.postStatus })
      .from(ChatRoom)
      .innerJoin(Post, eq(ChatRoom.postId, Post.id))
      .where(and(eq(ChatRoom.id, chatRoomId), eq(ChatRoom.deleted, false)));

    return result?.postStatus || null;
  }

  async findGameDateByChatRoomId(chatRoomId: number): Promise<string | null> {
    const [result] = await this.db
      .select({ gameDate: RecruitmentDetail.gameDate })
      .from(ChatRoom)
      .innerJoin(Post, eq(ChatRoom.postId, Post.id))
      .innerJoin(RecruitmentDetail, eq(Post.id, RecruitmentDetail.postId))
      .where(and(eq(ChatRoom.id, chatRoomId), eq(ChatRoom.deleted, false)));

    return result?.gameDate || null;
  }

  async updateChatRoomUpdatedAt(chatRoomId: number) {
    await this.db
      .update(ChatRoom)
      .set({ updatedAt: new Date() })
      .where(eq(ChatRoom.id, chatRoomId));
  }

  async updateLastReadAt(chatRoomId: number, memberId: number) {
    await this.db
      .update(ChatRoomMember)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(ChatRoomMember.chatRoomId, chatRoomId),
          eq(ChatRoomMember.memberId, memberId),
          eq(ChatRoomMember.deleted, false),
        ),
      );
  }

  async saveMessage(chatRoomId: number, senderId: number, content: string) {
    const [message] = await this.db
      .insert(ChatMessage)
      .values({ chatRoomId, senderId, content })
      .returning();

    return message;
  }

  async findMessagesByRoomId(chatRoomId: number, limit = 50) {
    const messages = await this.db
      .select({
        id: ChatMessage.id,
        content: ChatMessage.content,
        senderId: ChatMessage.senderId,
        createdAt: ChatMessage.createdAt,
        nickname: Profile.nickname,
        supportTeam: Profile.supportTeam,
      })
      .from(ChatMessage)
      .innerJoin(Profile, eq(ChatMessage.senderId, Profile.memberId))
      .where(eq(ChatMessage.chatRoomId, chatRoomId))
      .orderBy(desc(ChatMessage.createdAt))
      .limit(limit);

    return messages.reverse();
  }

  async findChatRoomMember(chatRoomId: number, memberId: number, tx?: DbTransaction) {
    const executor = tx || this.db;
    const [member] = await executor
      .select()
      .from(ChatRoomMember)
      .where(
        and(
          eq(ChatRoomMember.chatRoomId, chatRoomId),
          eq(ChatRoomMember.memberId, memberId),
          eq(ChatRoomMember.deleted, false),
        ),
      );

    return member || null;
  }

  async findChatRoomMembersByRoomId(chatRoomId: number) {
    const members = await this.db
      .select({
        memberId: ChatRoomMember.memberId,
        role: ChatRoomMember.role,
        nickname: Profile.nickname,
      })
      .from(ChatRoomMember)
      .innerJoin(Profile, eq(ChatRoomMember.memberId, Profile.memberId))
      .where(and(eq(ChatRoomMember.chatRoomId, chatRoomId), eq(ChatRoomMember.deleted, false)));

    return members;
  }

  async findAnyMemberIdByChatRoom(chatRoomId: number): Promise<number | null> {
    const [member] = await this.db
      .select({ memberId: ChatRoomMember.memberId })
      .from(ChatRoomMember)
      .where(and(eq(ChatRoomMember.chatRoomId, chatRoomId), eq(ChatRoomMember.deleted, false)))
      .limit(1);

    return member?.memberId ?? null;
  }

  async softDeleteChatRoomMember(chatRoomId: number, memberId: number) {
    const [updated] = await this.db
      .update(ChatRoomMember)
      .set({ deleted: true })
      .where(
        and(
          eq(ChatRoomMember.chatRoomId, chatRoomId),
          eq(ChatRoomMember.memberId, memberId),
          eq(ChatRoomMember.deleted, false),
        ),
      )
      .returning();

    return updated || null;
  }

  async softDeleteChatRoom(chatRoomId: number) {
    const [updated] = await this.db
      .update(ChatRoom)
      .set({ deleted: true })
      .where(eq(ChatRoom.id, chatRoomId))
      .returning();

    return updated || null;
  }

  async createJoinRequest(chatRoomId: number, memberId: number) {
    const [request] = await this.db
      .insert(ChatJoinRequest)
      .values({
        chatRoomId,
        memberId,
        status: ChatJoinRequestStatus.PENDING,
      })
      .returning({
        id: ChatJoinRequest.id,
        status: ChatJoinRequest.status,
        chatRoomId: ChatJoinRequest.chatRoomId,
        memberId: ChatJoinRequest.memberId,
      });

    return request;
  }

  async findPendingJoinRequests(chatRoomId: number) {
    const requests = await this.db
      .select({
        id: ChatJoinRequest.id,
        memberId: ChatJoinRequest.memberId,
        chatRoomId: ChatJoinRequest.chatRoomId,
        status: ChatJoinRequest.status,
        createdAt: ChatJoinRequest.createdAt,
        nickname: Profile.nickname,
        supportTeam: Profile.supportTeam,
        gender: Member.gender,
        birthDate: Member.birthDate,
      })
      .from(ChatJoinRequest)
      .innerJoin(Profile, eq(ChatJoinRequest.memberId, Profile.memberId))
      .innerJoin(Member, eq(ChatJoinRequest.memberId, Member.id))
      .where(
        and(
          eq(ChatJoinRequest.chatRoomId, chatRoomId),
          eq(ChatJoinRequest.status, ChatJoinRequestStatus.PENDING),
        ),
      )
      .orderBy(desc(ChatJoinRequest.createdAt));

    return requests;
  }

  async findJoinRequestById(requestId: number) {
    const [request] = await this.db
      .select({
        id: ChatJoinRequest.id,
        status: ChatJoinRequest.status,
        chatRoomId: ChatJoinRequest.chatRoomId,
        memberId: ChatJoinRequest.memberId,
      })
      .from(ChatJoinRequest)
      .where(eq(ChatJoinRequest.id, requestId));

    return request || null;
  }

  async updateJoinRequestStatus(
    requestId: number,
    status: ChatJoinRequestStatus,
    tx?: DbTransaction,
  ) {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(ChatJoinRequest)
      .set({ status })
      .where(
        and(
          eq(ChatJoinRequest.id, requestId),
          eq(ChatJoinRequest.status, ChatJoinRequestStatus.PENDING),
        ),
      )
      .returning({
        id: ChatJoinRequest.id,
        status: ChatJoinRequest.status,
      });

    return updated || null;
  }

  async findExistingJoinRequest(chatRoomId: number, memberId: number) {
    const [request] = await this.db
      .select({
        id: ChatJoinRequest.id,
        status: ChatJoinRequest.status,
        chatRoomId: ChatJoinRequest.chatRoomId,
        memberId: ChatJoinRequest.memberId,
      })
      .from(ChatJoinRequest)
      .where(
        and(eq(ChatJoinRequest.chatRoomId, chatRoomId), eq(ChatJoinRequest.memberId, memberId)),
      );

    return request || null;
  }

  async resetJoinRequestToPending(chatRoomId: number, memberId: number) {
    const [updated] = await this.db
      .update(ChatJoinRequest)
      .set({ status: ChatJoinRequestStatus.PENDING })
      .where(
        and(eq(ChatJoinRequest.chatRoomId, chatRoomId), eq(ChatJoinRequest.memberId, memberId)),
      )
      .returning({
        id: ChatJoinRequest.id,
        status: ChatJoinRequest.status,
        chatRoomId: ChatJoinRequest.chatRoomId,
        memberId: ChatJoinRequest.memberId,
      });

    return updated || null;
  }
}
