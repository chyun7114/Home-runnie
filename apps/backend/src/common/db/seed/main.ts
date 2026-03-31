import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Member, Profile } from '@/member/domain';
import { Report, ReportCount } from '@/report/domain';
import { Warn } from '@/admin/domain';
import { Post, RecruitmentDetail } from '@/post/domain';
import { Scrap } from '@/scrap/domain';
import { Participation } from '@/participation/domain';
import { ChatRoom, ChatRoomMember, ChatMessage, ChatJoinRequest } from '@/chat/domain';
import {
  OAuthProvider,
  RecruitmentRoleEnum,
  ReportType,
  Role,
  PostStatusEnum,
  Team,
} from '@/common/enums';
import type { InferInsertModel } from 'drizzle-orm';
import { Gender, PostType, ChatRoomMemberRole } from '@homerunnie/shared';

const REPORT_TYPES = [
  ReportType.SPAM,
  ReportType.HARASSMENT,
  ReportType.INAPPROPRIATE_CONTENT,
  ReportType.FRAUD,
  ReportType.OTHER,
];

const WARN_REASONS = [
  '부적절한 게시물 작성',
  '허위 신고',
  '욕설 및 비방',
  '스팸 행위',
  '커뮤니티 규칙 위반',
];

const GAME_TITLES = [
  '잠실에서 LG vs KIA 경기 함께 보실 분!',
  '수원 KT 홈경기 같이 보러 가요',
  '고척 키움 응원단 합류하실 분',
  '사직 롯데 홈경기 함께 응원해요',
  '대구 삼성 경기 관람 동행 구합니다',
  '인천 SSG 랜더스필드 같이 가실 분',
  '창원 NC 홈경기 함께 보기',
  '광주 KIA 홈경기 응원 가실 분',
  '서울 두산 잠실 경기 동행',
  '한화 대전 홈경기 함께 가요',
];

const TEAMS = [
  'LG 트윈스',
  'KIA 타이거즈',
  'KT 위즈',
  '키움 히어로즈',
  '롯데 자이언츠',
  '삼성 라이온즈',
  'SSG 랜더스',
  'NC 다이노스',
  '두산 베어스',
  '한화 이글스',
];

function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

export async function seeding() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool, {
    logger: true,
  });

  console.log('🌱 Seeding database...');

  // Clear all existing data first
  console.log('🧹 Clearing existing data...');
  await db.delete(ChatMessage);
  await db.delete(ChatRoomMember);
  await db.delete(ChatJoinRequest);
  await db.delete(ChatRoom);
  await db.delete(Participation);
  await db.delete(Scrap);
  await db.delete(RecruitmentDetail);
  await db.delete(Post);
  await db.delete(Warn);
  await db.delete(Report);
  await db.delete(ReportCount);
  await db.delete(Profile);
  await db.delete(Member);
  console.log('✅ Cleared all existing data');

  // 1. 다양한 권한을 가진 50명의 회원 생성
  const memberData: InferInsertModel<typeof Member>[] = [];
  for (let i = 1; i <= 50; i++) {
    const role = i <= 5 ? Role.ADMIN : Role.USER; // 첫 5명은 관리자
    const gender = getRandomElement([Gender.MALE, Gender.FEMALE, Gender.OTHER]);
    const OAuth = getRandomElement([
      OAuthProvider.GOOGLE,
      OAuthProvider.KAKAO,
      OAuthProvider.NAVER,
    ]);
    memberData.push({
      name: `User${i}`,
      email: `user${i}@example.com`,
      birthDate: `199${Math.floor(Math.random() * 10)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
      phoneNumber: `010-${1000 + Math.floor(Math.random() * 9000)}-${1000 + Math.floor(Math.random() * 9000)}`,
      gender,
      role,
      oauthProvider: OAuth,
      signUpStatus: true,
      createdAt: getRandomDate(new Date('2024-01-01'), new Date()),
      updatedAt: getRandomDate(new Date('2024-01-01'), new Date()),
    });
  }

  const insertedMembers = await db.insert(Member).values(memberData).returning();
  console.log(`✅ Created ${insertedMembers.length} members`);

  // 2. 각 회원에 대한 프로필 생성
  const profileData: InferInsertModel<typeof Profile>[] = insertedMembers.map((member, index) => {
    const supportTeam = Math.random() > 0.2 ? getRandomElement(Object.values(Team)) : null; // 80% 확률로 응원팀 설정
    return {
      nickname: `${member.name}_nickname`,
      supportTeam,
      memberId: member.id,
      createdAt: getRandomDate(new Date('2024-01-01'), new Date()),
      updatedAt: getRandomDate(new Date('2024-01-01'), new Date()),
    };
  });

  const insertedProfiles = await db.insert(Profile).values(profileData).returning();
  console.log(`✅ Created ${insertedProfiles.length} profiles`);

  // 3. 각 회원에 대한 신고 횟수 생성
  const reportCountData = insertedMembers.map((member) => ({
    memberId: member.id,
    reportingCount: Math.floor(Math.random() * 10),
    reportedCount: Math.floor(Math.random() * 5),
    createdAt: getRandomDate(new Date('2024-01-01'), new Date()),
    updatedAt: getRandomDate(new Date('2024-01-01'), new Date()),
  }));

  const insertedReportCounts = await db.insert(ReportCount).values(reportCountData).returning();
  console.log(`✅ Created ${insertedReportCounts.length} report counts`);

  // 4. 신고 생성 (회원 간의 관계)
  const reportData: InferInsertModel<typeof Report>[] = [];
  for (let i = 0; i < 80; i++) {
    // 80개의 신고 생성
    const reporter = getRandomElement(insertedMembers);
    let reported = getRandomElement(insertedMembers);

    // 신고자와 피신고자가 다른지 확인
    while (reported.id === reporter.id) {
      reported = getRandomElement(insertedMembers);
    }

    reportData.push({
      reportType: getRandomElement(REPORT_TYPES),
      content: `신고 내용 ${i + 1}: ${getRandomElement(REPORT_TYPES)}에 대한 신고입니다.`,
      reporterId: reporter.id,
      reportedId: reported.id,
      createdAt: getRandomDate(new Date('2024-01-01'), new Date()),
      updatedAt: getRandomDate(new Date('2024-01-01'), new Date()),
    });
  }

  const insertedReports = await db.insert(Report).values(reportData).returning();
  console.log(`✅ Created ${insertedReports.length} reports`);

  // 5. 경고 생성 (일부 회원에게만)
  const warnData: InferInsertModel<typeof Warn>[] = [];
  const membersToWarn = insertedMembers.filter(() => Math.random() < 0.4); // 40% 회원이 경고 받음

  for (const member of membersToWarn) {
    const numberOfWarns = Math.floor(Math.random() * 3) + 1; // 회원당 1-3개 경고
    for (let i = 0; i < numberOfWarns; i++) {
      warnData.push({
        reason: getRandomElement(WARN_REASONS),
        memberId: member.id,
        createdAt: getRandomDate(new Date('2024-01-01'), new Date()),
        updatedAt: getRandomDate(new Date('2024-01-01'), new Date()),
      });
    }
  }

  const insertedWarns = await db.insert(Warn).values(warnData).returning();
  console.log(`✅ Created ${insertedWarns.length} warns`);

  // 6. 모집 게시글 생성
  const postData: InferInsertModel<typeof Post>[] = [];
  for (let i = 1; i <= 30; i++) {
    const author = getRandomElement(insertedMembers);
    const postStatus = Math.random() > 0.3 ? PostStatusEnum.ACTIVE : PostStatusEnum.CLOSE; // 70% 활성, 30% 비활성
    postData.push({
      title: getRandomElement(GAME_TITLES),
      post_type: PostType.RECRUITMENT,
      postStatus,
      authorId: author.id,
      createdAt: getRandomDate(new Date('2024-01-01'), new Date()),
      updatedAt: getRandomDate(new Date('2024-01-01'), new Date()),
    });
  }

  const insertedPosts = await db.insert(Post).values(postData).returning();
  console.log(`✅ Created ${insertedPosts.length} recruitment posts`);

  // 7. 모집 상세 정보 생성
  const recruitmentDetailData: InferInsertModel<typeof RecruitmentDetail>[] = insertedPosts.map(
    (post) => {
      const homeTeam = getRandomElement(TEAMS);
      let awayTeam = getRandomElement(TEAMS);
      while (awayTeam === homeTeam) {
        awayTeam = getRandomElement(TEAMS);
      }

      // 게임 날짜를 현재부터 3개월 후까지 랜덤하게 설정
      const gameDate = getRandomDate(new Date(), new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));
      // 게임 시간도 랜덤하게 설정 (오후 2시~7시)
      const gameTime = new Date(gameDate);
      gameTime.setHours(14 + Math.floor(Math.random() * 5), 0, 0, 0);

      const stadiums = [
        '잠실야구장',
        '고척스카이돔',
        '수원KT위즈파크',
        '사직야구장',
        '대구삼성라이온즈파크',
      ];

      return {
        postId: post.id,
        gameDate: gameDate.toISOString(),
        gameTime: gameTime.toISOString(),
        stadium: getRandomElement(stadiums),
        teamHome: homeTeam,
        teamAway: awayTeam,
        recruitmentLimit: Math.floor(Math.random() * 8) + 2, // 2-10명
        currentParticipants: Math.floor(Math.random() * 3), // 0-3명
        message: `${homeTeam} vs ${awayTeam} 경기 함께 보러 가요! 야구 좋아하는 분들 환영합니다.`,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      };
    },
  );

  const insertedRecruitmentDetails = await db
    .insert(RecruitmentDetail)
    .values(recruitmentDetailData)
    .returning();
  console.log(`✅ Created ${insertedRecruitmentDetails.length} recruitment details`);

  // 8. 스크랩 데이터 생성 (특히 테스트 회원이 여러 게시글을 스크랩)
  const scrapData: InferInsertModel<typeof Scrap>[] = [];

  // 첫 번째 회원(User1)이 10개 게시글을 스크랩
  const testUser = insertedMembers[0]; // User1
  for (let i = 0; i < Math.min(10, insertedPosts.length); i++) {
    scrapData.push({
      memberId: testUser.id,
      postId: insertedPosts[i].id,
      createdAt: getRandomDate(new Date('2024-01-01'), new Date()),
      updatedAt: getRandomDate(new Date('2024-01-01'), new Date()),
    });
  }

  // 다른 회원들도 랜덤하게 스크랩
  for (let i = 0; i < 50; i++) {
    const member = getRandomElement(insertedMembers);
    const post = getRandomElement(insertedPosts);

    // 중복 방지를 위해 이미 존재하는지 확인
    const exists = scrapData.some((s) => s.memberId === member.id && s.postId === post.id);
    if (!exists) {
      scrapData.push({
        memberId: member.id,
        postId: post.id,
        createdAt: getRandomDate(new Date('2024-01-01'), new Date()),
        updatedAt: getRandomDate(new Date('2024-01-01'), new Date()),
      });
    }
  }

  const insertedScraps = await db.insert(Scrap).values(scrapData).returning();
  console.log(`✅ Created ${insertedScraps.length} scraps`);

  // 9. 참여 데이터 생성 (특히 테스트 회원이 여러 모집글에 참여)
  const participationData: InferInsertModel<typeof Participation>[] = [];

  // 첫 번째 회원(User1)이 8개 모집에 참여
  for (let i = 0; i < Math.min(8, insertedRecruitmentDetails.length); i++) {
    participationData.push({
      role: RecruitmentRoleEnum.PARTICIPANT,
      joinedAt: getRandomDate(new Date('2024-01-01'), new Date()),
      memberId: testUser.id,
      recruitmentDetailId: insertedRecruitmentDetails[i].id,
      createdAt: getRandomDate(new Date('2024-01-01'), new Date()),
      updatedAt: getRandomDate(new Date('2024-01-01'), new Date()),
    });
  }

  // 다른 회원들도 랜덤하게 참여
  for (let i = 0; i < 60; i++) {
    const member = getRandomElement(insertedMembers);
    const recruitmentDetail = getRandomElement(insertedRecruitmentDetails);

    // 중복 방지를 위해 이미 존재하는지 확인
    const exists = participationData.some(
      (p) => p.memberId === member.id && p.recruitmentDetailId === recruitmentDetail.id,
    );
    if (!exists) {
      participationData.push({
        role: RecruitmentRoleEnum.PARTICIPANT,
        joinedAt: getRandomDate(new Date('2024-01-01'), new Date()),
        memberId: member.id,
        recruitmentDetailId: recruitmentDetail.id,
        createdAt: getRandomDate(new Date('2024-01-01'), new Date()),
        updatedAt: getRandomDate(new Date('2024-01-01'), new Date()),
      });
    }
  }

  const insertedParticipations = await db
    .insert(Participation)
    .values(participationData)
    .returning();
  console.log(`✅ Created ${insertedParticipations.length} participations`);

  // 10. 채팅방 생성 (각 Post마다 하나씩)
  const chatRoomData: InferInsertModel<typeof ChatRoom>[] = insertedPosts.map((post) => ({
    postId: post.id,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  }));

  const insertedChatRooms = await db.insert(ChatRoom).values(chatRoomData).returning();
  console.log(`✅ Created ${insertedChatRooms.length} chat rooms`);

  // 11. 채팅방 멤버 생성
  const chatRoomMemberData: InferInsertModel<typeof ChatRoomMember>[] = [];

  // 각 채팅방에 대해 멤버 추가
  for (const chatRoom of insertedChatRooms) {
    const post = insertedPosts.find((p) => p.id === chatRoom.postId);
    if (!post) continue;

    // 1) 게시글 작성자를 HOST로 추가
    chatRoomMemberData.push({
      role: ChatRoomMemberRole.HOST,
      chatRoomId: chatRoom.id,
      memberId: post.authorId,
      createdAt: chatRoom.createdAt,
      updatedAt: chatRoom.updatedAt,
    });

    // 2) 해당 게시글의 RecruitmentDetail 찾기
    const recruitmentDetail = insertedRecruitmentDetails.find((rd) => rd.postId === post.id);
    if (!recruitmentDetail) continue;

    // 3) 해당 모집글에 참여한 멤버들을 MEMBER로 추가
    const participations = insertedParticipations.filter(
      (p) => p.recruitmentDetailId === recruitmentDetail.id,
    );

    for (const participation of participations) {
      // 작성자는 이미 HOST로 추가했으므로 제외
      if (participation.memberId === post.authorId) continue;

      chatRoomMemberData.push({
        role: ChatRoomMemberRole.MEMBER,
        chatRoomId: chatRoom.id,
        memberId: participation.memberId,
        createdAt: chatRoom.createdAt,
        updatedAt: chatRoom.updatedAt,
      });
    }
  }

  const insertedChatRoomMembers = await db
    .insert(ChatRoomMember)
    .values(chatRoomMemberData)
    .returning();
  console.log(`✅ Created ${insertedChatRoomMembers.length} chat room members`);

  // 12. 채팅 메시지 생성 (각 채팅방에 2-5개씩)
  const chatMessageData: InferInsertModel<typeof ChatMessage>[] = [];

  const SAMPLE_MESSAGES = [
    '안녕하세요! 같이 야구 보러 가요!',
    '저도 참여하고 싶습니다!',
    '몇 시에 만날까요?',
    '경기장 앞에서 만나는 게 어떨까요?',
    '응원 도구 챙겨가세요!',
    '날씨가 좋네요 ☀️',
    '기대됩니다!',
    '혹시 주차는 어디에 하시나요?',
    '같이 치맥 어때요?',
    '홈팀 응원석 앉으시나요?',
  ];

  for (const chatRoom of insertedChatRooms) {
    // 해당 채팅방의 멤버들 가져오기
    const roomMembers = insertedChatRoomMembers.filter((m) => m.chatRoomId === chatRoom.id);

    if (roomMembers.length === 0) continue;

    // 2-5개의 메시지 생성
    const messageCount = Math.floor(Math.random() * 4) + 2;
    for (let i = 0; i < messageCount; i++) {
      const sender = getRandomElement(roomMembers);
      chatMessageData.push({
        content: getRandomElement(SAMPLE_MESSAGES),
        chatRoomId: chatRoom.id,
        senderId: sender.memberId,
        createdAt: getRandomDate(chatRoom.createdAt!, new Date()),
        updatedAt: getRandomDate(chatRoom.createdAt!, new Date()),
      });
    }
  }

  const insertedChatMessages = await db.insert(ChatMessage).values(chatMessageData).returning();
  console.log(`✅ Created ${insertedChatMessages.length} chat messages`);

  console.log('🎉 Seeding completed successfully!');
  console.log(`📊 Summary:`);
  console.log(
    `   - Members: ${insertedMembers.length} (${insertedMembers.filter((m) => m.role === 'ADMIN').length} admins, ${insertedMembers.filter((m) => m.role === 'USER').length} users)`,
  );
  console.log(`   - Profiles: ${insertedProfiles.length}`);
  console.log(`   - Report Counts: ${insertedReportCounts.length}`);
  console.log(`   - Reports: ${insertedReports.length}`);
  console.log(`   - Warns: ${insertedWarns.length}`);
  console.log(`   - Posts: ${insertedPosts.length}`);
  console.log(`   - Recruitment Details: ${insertedRecruitmentDetails.length}`);
  console.log(`   - Scraps: ${insertedScraps.length}`);
  console.log(`   - Participations: ${insertedParticipations.length}`);
  console.log(`   - Chat Rooms: ${insertedChatRooms.length}`);
  console.log(`   - Chat Room Members: ${insertedChatRoomMembers.length}`);
  console.log(`   - Chat Messages: ${insertedChatMessages.length}`);
  console.log(`🧪 Test User1 has:`);
  console.log(`   - Scrapped ${scrapData.filter((s) => s.memberId === testUser.id).length} posts`);
  console.log(
    `   - Participated in ${participationData.filter((p) => p.memberId === testUser.id).length} recruitments`,
  );
  console.log(
    `   - Written ${insertedPosts.filter((p) => p.authorId === testUser.id).length} posts`,
  );
  console.log(
    `   - Joined ${insertedChatRoomMembers.filter((m) => m.memberId === testUser.id).length} chat rooms`,
  );

  // 데이터베이스 연결 종료
  await pool.end();
}
