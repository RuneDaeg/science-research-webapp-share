// Supabase 프로젝트 연결 후 `supabase gen types typescript`로 재생성 권장.
// 지금은 supabase/migrations/0001_init.sql 스키마를 손으로 맞춘 타입.
//
// 주의: 아래 Row 타입들은 반드시 `interface`가 아닌 `type`으로 선언해야 한다.
// TypeScript에서 interface는 Record<string, unknown> 같은 인덱스 시그니처 타입에
// `extends`되지 않아 (구조적으로 동일해도) Supabase의 GenericSchema 제약을 통과하지
// 못하고 모든 쿼리 결과가 `never`로 무너지는 문제가 있다.

export type Role = "admin" | "teacher" | "student";
export type ResearchField = "physics" | "chemistry" | "biology" | "earth" | "convergence";
export type ProjectStatus = "planning" | "in_progress" | "completed";
export type DocumentStage = "plan" | "journal" | "interim" | "final";
export type ExtractionStatus = "pending" | "ok" | "failed";
export type TeamRole = "leader" | "member";
// chat = 사용법 안내 챗봇. 피드백 생성보다 훨씬 빠르므로 응답 상태 집계(lib/ai/health.ts)에서는
// 반드시 제외한다 — 섞으면 중앙값이 낮아져 실제보다 원활해 보인다.
export type AiUsageKind = "draft" | "verify" | "chat" | "grade";

// 실패 원인. timeout/ai_error만 '몰림'의 신호로 취급한다 — refusal은 그 문서의 문제이고,
// rate_limit(학생 일일 상한)은 정상 동작이다.
//
// config(키 미설정)는 예약값이며 현재는 기록되지 않는다. MissingCredentialError는
// getServerCredential()에서 던져지는데, 그 시점에는 provider/model을 알 수 없어
// ai_usage_log의 NOT NULL 컬럼을 채울 수 없기 때문이다.
export type AiUsageErrorKind = "timeout" | "ai_error" | "refusal" | "rate_limit" | "config";

export type Profile = {
  id: string;
  role: Role;
  display_name: string;
  school_name: string | null;
  created_at: string;
};

export type ClassRow = {
  id: string;
  teacher_id: string;
  name: string;
  school_year: string | null;
  join_code: string;
  created_at: string;
};

export type ClassEnrollment = {
  id: string;
  class_id: string;
  student_id: string;
  joined_at: string;
};

export type ClassAnnouncement = {
  id: string;
  class_id: string;
  teacher_id: string;
  body: string;
  created_at: string;
};

export type ResearchProject = {
  id: string;
  class_id: string;
  owner_id: string;
  title: string;
  field: ResearchField;
  research_question: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
};

export type ProjectMember = {
  id: string;
  project_id: string;
  student_id: string;
  role_in_team: TeamRole;
  joined_at: string;
};

export type ResearchDocument = {
  id: string;
  project_id: string;
  uploaded_by: string;
  stage: DocumentStage;
  title: string;
  round_no: number | null;
  note: string | null;
  file_path: string;
  file_mime: string;
  // 0003 이전에 올라온 산출물은 null. 관리자 화면의 사용량 집계가 '미집계'로 구분한다.
  file_size: number | null;
  original_filename: string;
  extracted_text: string | null;
  extraction_status: ExtractionStatus;
  created_at: string;
};

export type AiFeedback = {
  id: string;
  document_id: string;
  body: string;
  rating: number | null;
  provider: string;
  model: string;
  signature: string;
  verified: boolean;
  created_at: string;
  updated_at: string;
};

// 학생에게 노출되는 AI 피드백 (rating 없음 — student_ai_feedbacks 뷰).
// 학생 화면에서는 반드시 이 타입을 쓴다. AiFeedback(별점 포함)을 그대로 내려보내지 말 것.
export type StudentAiFeedback = {
  id: string;
  document_id: string;
  body: string;
  verified: boolean;
  created_at: string;
  updated_at: string;
};

export type TeacherFeedback = {
  id: string;
  document_id: string;
  teacher_id: string;
  body: string;
  visible_to_student: boolean;
  created_at: string;
  updated_at: string;
};

// 교사가 올리는 과제/평가 글. 연구 과제(research_projects)와 별개로 클래스에 딸린다.
export type ClassAssignment = {
  id: string;
  class_id: string;
  teacher_id: string;
  title: string;
  body: string | null;
  // 마감이 지나도 제출은 막지 않는다. 화면 표시용이다.
  due_at: string | null;
  created_at: string;
  // 채점기준 파일(0011). AI 채점은 이 파일이 있어야 돌 수 있다.
  rubric_path: string | null;
  rubric_mime: string | null;
  rubric_size: number | null;
  rubric_filename: string | null;
};

// 과제 하나에 학생 한 명당 한 건(unique). 파일은 assignment_submission_files에 달린다.
export type AssignmentSubmission = {
  id: string;
  assignment_id: string;
  student_id: string;
  note: string | null;
  submitted_at: string;
};

// 제출물에 달린 파일. 한 제출물에 여러 개 올 수 있다(0009).
export type AssignmentSubmissionFile = {
  id: string;
  submission_id: string;
  file_path: string;
  file_mime: string;
  file_size: number | null;
  original_filename: string;
  uploaded_at: string;
};

// AI 채점 결과(0011, assignment_ai_grades.result). 점수가 들어 있으므로 교사 화면 전용이다.
export type GradeCriterion = {
  name: string; // 평가요소 (예: "가설 설정")
  score: number | null; // 채점기준표에 적힌 배점 중 하나. 판단을 보류하면 null
  max: number; // 그 평가요소의 만점
  level: string; // 해당한다고 본 채점기준 문장
  evidence: string; // 제출물에서 찾은 근거(파일·위치)
  reason: string; // 왜 이 단계인지, 한 단계 위로 가려면 무엇이 부족한지
};

export type AssignmentGradeResult = {
  rubric_used: string; // 채점기준 파일에서 실제로 쓴 평가의 이름
  criteria: GradeCriterion[];
  // 제출 파일만으로 채점할 수 없는 요소(발표·질의응답 등). 합계에서 빠진다.
  ungradable: Array<{ name: string; reason: string }>;
  teacher_notes: string[]; // 교사가 직접 확인해야 할 것
  student_feedback: string; // 학생에게 줄 피드백(점수 없음)
};

export type AssignmentAiGrade = {
  id: string;
  submission_id: string;
  result: AssignmentGradeResult;
  total_score: number | null;
  max_score: number | null;
  student_feedback: string;
  released: boolean;
  provider: string;
  model: string;
  signature: string;
  created_at: string;
  updated_at: string;
};

// 학생에게 노출되는 채점 피드백(student_assignment_feedbacks 뷰). 점수·근거는 없다.
export type StudentAssignmentFeedback = {
  submission_id: string;
  student_feedback: string;
  updated_at: string;
};

export type AiUsageLog = {
  id: string;
  student_id: string | null;
  class_id: string | null;
  document_id: string | null;
  kind: AiUsageKind;
  provider: string;
  model: string;
  // AI 제공사 호출에 걸린 시간(ms). 0004 이전 기록은 null이라 집계에서 제외된다.
  duration_ms: number | null;
  // 0005부터 실패한 호출도 기록된다. 이전 기록은 모두 성공이라 true.
  ok: boolean;
  error_kind: AiUsageErrorKind | null;
  created_at: string;
};

type Relationships = never[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; role: Role };
        Update: Partial<Profile>;
        Relationships: Relationships;
      };
      classes: {
        Row: ClassRow;
        Insert: Partial<ClassRow> & { teacher_id: string; name: string; join_code: string };
        Update: Partial<ClassRow>;
        Relationships: Relationships;
      };
      class_enrollments: {
        Row: ClassEnrollment;
        Insert: Partial<ClassEnrollment> & { class_id: string; student_id: string };
        Update: Partial<ClassEnrollment>;
        Relationships: Relationships;
      };
      class_announcements: {
        Row: ClassAnnouncement;
        Insert: Partial<ClassAnnouncement> & { class_id: string; teacher_id: string; body: string };
        Update: Partial<ClassAnnouncement>;
        Relationships: Relationships;
      };
      research_projects: {
        Row: ResearchProject;
        Insert: Partial<ResearchProject> & {
          class_id: string;
          owner_id: string;
          title: string;
          field: ResearchField;
        };
        Update: Partial<ResearchProject>;
        Relationships: Relationships;
      };
      project_members: {
        Row: ProjectMember;
        Insert: Partial<ProjectMember> & { project_id: string; student_id: string };
        Update: Partial<ProjectMember>;
        Relationships: Relationships;
      };
      research_documents: {
        Row: ResearchDocument;
        Insert: Partial<ResearchDocument> & {
          project_id: string;
          uploaded_by: string;
          stage: DocumentStage;
          title: string;
          file_path: string;
          file_mime: string;
          original_filename: string;
        };
        Update: Partial<ResearchDocument>;
        Relationships: Relationships;
      };
      ai_feedbacks: {
        Row: AiFeedback;
        Insert: Partial<AiFeedback> & {
          document_id: string;
          body: string;
          provider: string;
          model: string;
          signature: string;
        };
        Update: Partial<AiFeedback>;
        Relationships: Relationships;
      };
      teacher_feedbacks: {
        Row: TeacherFeedback;
        Insert: Partial<TeacherFeedback> & {
          document_id: string;
          teacher_id: string;
          body: string;
        };
        Update: Partial<TeacherFeedback>;
        Relationships: Relationships;
      };
      class_assignments: {
        Row: ClassAssignment;
        Insert: Partial<ClassAssignment> & { class_id: string; teacher_id: string; title: string };
        Update: Partial<ClassAssignment>;
        Relationships: Relationships;
      };
      assignment_submissions: {
        Row: AssignmentSubmission;
        Insert: Partial<AssignmentSubmission> & {
          assignment_id: string;
          student_id: string;
        };
        Update: Partial<AssignmentSubmission>;
        Relationships: Relationships;
      };
      assignment_submission_files: {
        Row: AssignmentSubmissionFile;
        Insert: Partial<AssignmentSubmissionFile> & {
          submission_id: string;
          file_path: string;
          file_mime: string;
          original_filename: string;
        };
        Update: Partial<AssignmentSubmissionFile>;
        Relationships: Relationships;
      };
      assignment_ai_grades: {
        Row: AssignmentAiGrade;
        Insert: Partial<AssignmentAiGrade> & {
          submission_id: string;
          result: AssignmentGradeResult;
          student_feedback: string;
          provider: string;
          model: string;
          signature: string;
        };
        Update: Partial<AssignmentAiGrade>;
        Relationships: Relationships;
      };
      ai_usage_log: {
        Row: AiUsageLog;
        Insert: Partial<AiUsageLog> & { kind: AiUsageKind; provider: string; model: string };
        Update: Partial<AiUsageLog>;
        Relationships: Relationships;
      };
    };
    Views: {
      student_ai_feedbacks: { Row: StudentAiFeedback; Relationships: Relationships };
      student_assignment_feedbacks: {
        Row: StudentAssignmentFeedback;
        Relationships: Relationships;
      };
    };
    Functions: Record<string, never>;
  };
};
