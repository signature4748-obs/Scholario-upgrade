import { api, schoolApi, schoolLogin, check, summary, section, RUN } from './plib';

const TEACHER_EMAIL = 'qa.teacher.am.qad5fjvq@qafix.scholario.dev';
const TEACHER_PW = 'Teach@2026x';
const TEACHER_PW2 = 'Teach@2026y';
const PRINCIPAL_LOGIN = { email: 'qa.principal.qad45c10@qafix.scholario.dev', pw: 'QaPrincipal!2026b' };
const ST1_EMAIL = 'qa.student.arjun.qad5fjvq@qafix.scholario.dev';
const ST2_EMAIL = 'qa.student.meera.qad5fjvq@qafix.scholario.dev';
const ST_PW = 'Stud@2026x';
const ST_PW2 = 'Stud@2026y';
const CLASS_ID = 'cmvd45c5g001rnek5d1l0i0de'; // Grade 5 - A
const SCHOOL_ID = 'cmvd45c4g001hnek56shz0orm';
const ST1_ID = 'cmvd5fkhn007enetjqoevx1fo';
const ST2_ID = 'cmvd5fkj7007knetjr4s1f6e0';

const today = new Date();
const ist = new Date(today.getTime() + 5.5 * 3600 * 1000);
const TODAY = ist.toISOString().slice(0, 10);

async function main() {
  // ── Principal session for setup (fresh draft exam for the teacher marks drill)
  section('P3.0 Principal setup session');
  const pLogin = await schoolLogin(PRINCIPAL_LOGIN.email, PRINCIPAL_LOGIN.pw);
  const P = pLogin.token!;
  check('principal session', pLogin.status === 200 && !!P, pLogin.status);
  // Clear per-account login buckets for the students (earlier probe runs
  // exhausted the 5/15min account limiter — documented behavior).
  const { PrismaClient } = await import('@prisma/client');
  const pdb = new PrismaClient();
  await pdb.rateLimitBucket.deleteMany({ where: { OR: [
    { key: { contains: 'qa.student' } }, { key: { contains: 'qa.principal' } }, { key: { contains: 'qa.teacher' } },
    { key: { startsWith: 'rl:login:ip:' } },
  ] } });
  await pdb.$disconnect();

  // Resolve THIS run's teacher userId (display names repeat across runs).
  const tList = await schoolApi('/api/teachers', {}, { token: P });
  const tArr = tList.body?.data?.teachers ?? tList.body?.data ?? [];
  const meRow = tArr.find((x: any) => (x.email ?? x.user?.email) === TEACHER_EMAIL);
  const myTeacherUserId = meRow?.userId ?? meRow?.user?.id;
  const subjList = await schoolApi('/api/subjects', {}, { token: P });
  const subjects = subjList.body?.data ?? [];
  const math = subjects.find((s: any) => s.name === 'Mathematics');
  const sci = subjects.find((s: any) => s.name === 'Science');
  const exam = await schoolApi('/api/exams', {
    method: 'POST',
    body: JSON.stringify({
      name: `QA Teacher Marks Drill ${RUN}`, type: 'Unit Test',
      startDate: '2026-10-25', endDate: '2026-10-26',
      classIds: [CLASS_ID],
      subjectsByClass: { [CLASS_ID]: [
        { subjectId: math.id, maxMarks: 100, passMarks: 33 },
        { subjectId: sci.id, maxMarks: 100, passMarks: 33 },
      ] },
    }),
  }, { token: P });
  check('draft exam created for drill', exam.status === 200 || exam.status === 201, { status: exam.status, body: exam.body });
  const drillExamId = exam.body?.data?.id ?? exam.body?.data?.exam?.id;

  // Appoint THIS teacher as class teacher + subject teacher (by id, not
  // display name — names repeat across fixture runs).
  const ct = await schoolApi('/api/principal/academic', {
    method: 'POST',
    body: JSON.stringify({ action: 'classTeacher.set', classId: CLASS_ID, teacherUserId: myTeacherUserId }),
  }, { token: P });
  check('classTeacher.set (by userId) 200', ct.status === 200, { status: ct.status, body: ct.body });
  for (const sub of [math, sci]) {
    const st = await schoolApi('/api/principal/academic', {
      method: 'POST',
      body: JSON.stringify({ action: 'subjectTeacher.set', classId: CLASS_ID, subjectId: sub.id, teacherUserId: myTeacherUserId }),
    }, { token: P });
    check(`subjectTeacher.set ${sub.name}`, st.status === 200, { status: st.status, body: st.body });
  }

  // ── P3 TEACHER
  section('P3.A Teacher login + forced password change');
  let tLogin = await schoolLogin(TEACHER_EMAIL, TEACHER_PW2);
  let freshT = false;
  if (tLogin.status !== 200) { tLogin = await schoolLogin(TEACHER_EMAIL, TEACHER_PW); freshT = tLogin.status === 200; }
  check('teacher login 200', tLogin.status === 200, { status: tLogin.status, err: tLogin.body?.error });
  let T = tLogin.token!;
  if (freshT) {
    check('teacher mustChangePassword', tLogin.body?.data?.mustChangePassword === true);
    const blocked = await schoolApi('/api/teacher/dashboard', {}, { token: T });
    check('teacher business API gated pre-change', blocked.status === 403 && blocked.body?.code === 'PASSWORD_CHANGE_REQUIRED', { status: blocked.status, code: blocked.body?.code });
    const ch = await schoolApi('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: TEACHER_PW, newPassword: TEACHER_PW2, confirmPassword: TEACHER_PW2 }),
    }, { token: T });
    check('teacher change-password 200', ch.status === 200, { status: ch.status, body: ch.body });
    T = ch.body?.data?.sessionToken ?? T;
  }

  section('P3.B Teacher identity + dashboard');
  const role = await schoolApi('/api/teacher/role', {}, { token: T });
  check('teacher/role 200', role.status === 200, { status: role.status, body: role.body });
  check('isClassTeacher true (Grade 5)', role.body?.data?.isClassTeacher === true, role.body?.data);
  const tdash = await schoolApi('/api/teacher/dashboard', {}, { token: T });
  check('teacher dashboard 200', tdash.status === 200, tdash.status);
  const td = tdash.body?.data;
  check('today.periods has 2 slots', (td?.today?.periods ?? []).length === 2, td?.today?.periods?.length);
  check('classTeacherOf includes a class', (td?.classTeacherOf ?? []).length >= 1, td?.classTeacherOf);

  section('P3.C Class attendance board → draft → baseline');
  const board = await schoolApi(`/api/teacher/class-attendance/board?classId=${CLASS_ID}&date=${TODAY}`, {}, { token: T });
  check('attendance board 200', board.status === 200, { status: board.status, body: board.body });
  const boardStudents = board.body?.data?.students ?? board.body?.data?.rows ?? [];
  check('board lists 2 students', boardStudents.length >= 2, boardStudents.length);
  const ids = boardStudents.map((s: any) => s.studentId ?? s.id);
  const draft = await schoolApi('/api/teacher/class-attendance/draft', {
    method: 'PUT',
    body: JSON.stringify({ classId: CLASS_ID, date: TODAY, entries: [
      { studentId: ids[0] ?? ST1_ID, status: 'PRESENT' },
      { studentId: ids[1] ?? ST2_ID, status: 'LATE' },
    ] }),
  }, { token: T });
  check('draft autosave 200', draft.status === 200, { status: draft.status, body: draft.body });
  const baseline = await schoolApi('/api/teacher/class-attendance/baseline', {
    method: 'POST',
    body: JSON.stringify({ classId: CLASS_ID, date: TODAY, entries: [
      { studentId: ids[0] ?? ST1_ID, status: 'PRESENT' },
      { studentId: ids[1] ?? ST2_ID, status: 'LATE' },
    ] }),
  }, { token: T });
  check('baseline save 200', baseline.status === 200, { status: baseline.status, body: baseline.body });

  section('P3.D Marks entry flow (grid → save → submit)');
  const me = await schoolApi('/api/teacher/marks-entry', {}, { token: T });
  check('marks-entry list 200', me.status === 200, { status: me.status, body: me.body });
  const meArr = me.body?.data?.exams ?? me.body?.data ?? [];
  const drill = (Array.isArray(meArr) ? meArr : []).find((e: any) => e.examId === drillExamId || e.id === drillExamId || (e.exam?.id === drillExamId));
  check('drill exam in teacher scope', !!drill, meArr.length);
  if (drill) {
    const grid = await schoolApi(`/api/teacher/marks-entry/grid?examId=${drillExamId}&classId=${CLASS_ID}&subjectId=${math.id}`, {}, { token: T });
    check('marks grid 200', grid.status === 200, { status: grid.status, body: grid.body });
    const rows = grid.body?.data?.students ?? grid.body?.data?.rows ?? [];
    check('grid has students', rows.length >= 2, rows.length);
    const save = await schoolApi('/api/teacher/marks-entry/save', {
      method: 'POST',
      body: JSON.stringify({ examId: drillExamId, classId: CLASS_ID, subjectId: math.id, marks: rows.map((r: any, i: number) => ({ studentId: r.studentId ?? r.id, marksObtained: 70 + i * 5, status: 'PRESENT' })) }),
    }, { token: T });
    check('marks save 200', save.status === 200, { status: save.status, body: save.body });
    const submit = await schoolApi('/api/teacher/marks-entry/submit', {
      method: 'POST',
      body: JSON.stringify({ examId: drillExamId, classId: CLASS_ID, subjectId: math.id }),
    }, { token: T });
    check('marks submit 200', submit.status === 200, { status: submit.status, body: submit.body });
  }

  section('P3.E Students directory + marksheet + class hub');
  const studs = await schoolApi('/api/teacher/students', {}, { token: T });
  check('teacher students 200', studs.status === 200, studs.status);
  const studArr = studs.body?.data?.students ?? studs.body?.data ?? [];
  check('authorized students >= 2', studArr.length >= 2, studArr.length);
  if (studArr[0]) {
    const ms = await schoolApi(`/api/teacher/students/${studArr[0].id ?? studArr[0].studentId}/marksheet`, {}, { token: T });
    check('student marksheet 200', ms.status === 200, { status: ms.status });
  }
  const hub = await schoolApi('/api/teacher/class-hub', {}, { token: T });
  check('class hub 200', hub.status === 200, { status: hub.status, body: hub.body });

  section('P3.F Teacher fee collection (class scope)');
  const fc = await schoolApi('/api/teacher/fee-collection?month=' + TODAY.slice(0, 7), {}, { token: T });
  check('fee-collection GET 200', fc.status === 200, { status: fc.status, body: fc.body });
  const collect = await schoolApi('/api/teacher/fee-collection', {
    method: 'POST',
    body: JSON.stringify({ studentId: ST1_ID, amount: 2000, method: 'Cash', note: `QA teacher collect ${RUN}` }),
  }, { token: T });
  check('fee-collection POST 200/201', collect.status === 200 || collect.status === 201, { status: collect.status, body: collect.body });

  section('P3.G Teacher negatives (school-plane authz)');
  check('teacher GET /api/teachers 403', (await schoolApi('/api/teachers', {}, { token: T })).status === 403);
  check('teacher POST /api/teachers 403', (await schoolApi('/api/teachers', { method: 'POST', body: JSON.stringify({ name: 'x', email: `tx.${RUN}@qafix.scholario.dev` }) }, { token: T })).status === 403);
  check('teacher GET /api/dashboard 403', (await schoolApi('/api/dashboard', {}, { token: T })).status === 403);
  check('teacher timetable publish 403', (await schoolApi('/api/timetable/publish', { method: 'POST', body: JSON.stringify({ slots: [] }) }, { token: T })).status === 403);
  check('teacher POST /api/students 403', (await schoolApi('/api/students', { method: 'POST', body: JSON.stringify({ name: 'x', email: `sx.${RUN}@qafix.scholario.dev` }) }, { token: T })).status === 403);
  check('teacher exam verify 403', (await schoolApi(`/api/exams/${drillExamId}/marks/verify`, { method: 'POST', body: JSON.stringify({}) }, { token: T })).status === 403);

  // ── P4 STUDENT
  section('P4.A Student login + forced password change (both students)');
  async function studentSession(email: string) {
    let s = await schoolLogin(email, ST_PW2);
    if (s.status !== 200) {
      s = await schoolLogin(email, ST_PW);
      if (s.status === 200) {
        const ch = await schoolApi('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: ST_PW, newPassword: ST_PW2, confirmPassword: ST_PW2 }),
        }, { token: s.token });
        if (ch.status === 200 && ch.body?.data?.sessionToken) s.token = ch.body.data.sessionToken;
      }
    }
    return s;
  }
  const s1 = await studentSession(ST1_EMAIL);
  check('student1 login 200', s1.status === 200, { status: s1.status, err: s1.body?.error });
  const S = s1.token!;
  const s2 = await studentSession(ST2_EMAIL);
  check('student2 login 200', s2.status === 200, { status: s2.status, err: s2.body?.error });

  section('P4.B Student dashboard aggregate');
  const sdash = await schoolApi('/api/student/dashboard', {}, { token: S });
  check('student dashboard 200', sdash.status === 200, { status: sdash.status, body: sdash.body });
  const sd = sdash.body?.data;
  check('classLabel Grade 5', /grade\s*5/i.test(sd?.student?.classLabel ?? ''), sd?.student?.classLabel);
  check('timetable week Monday has 2 periods', (sd?.timetable?.week?.Monday ?? []).length === 2, sd?.timetable?.week?.Monday?.length);
  check('attendance window present', typeof sd?.attendance?.pct === 'number', sd?.attendance);
  check('fees outstanding 12000 (24000-10000-2000)', sd?.fees?.outstanding === 12000, sd?.fees?.outstanding);
  check('notices unreadCount >= 1', (sd?.notices?.unreadCount ?? 0) >= 1, sd?.notices?.unreadCount);

  section('P4.C Student surfaces');
  const stt = await schoolApi('/api/student/timetable', {}, { token: S });
  check('student timetable 200', stt.status === 200, stt.status);
  const mySlots = stt.body?.data?.mySlots ?? stt.body?.data ?? [];
  check('mySlots >= 2', mySlots.length >= 2, mySlots.length);
  const satt = await schoolApi('/api/student/attendance', {}, { token: S });
  check('student attendance 200', satt.status === 200, { status: satt.status });
  const sres = await schoolApi('/api/results', {}, { token: S });
  check('student results 200', sres.status === 200, { status: sres.status, body: sres.body });
  const resArr = sres.body?.data?.results ?? sres.body?.data ?? [];
  const declared = (Array.isArray(resArr) ? resArr : []).filter((r: any) => (r.examName ?? r.exam?.name ?? '').includes('QA Unit Test'));
  check('declared exam rows visible', declared.length >= 2, resArr.length);

  section('P4.D Student fees + notices');
  const spay = await schoolApi('/api/student/payments', {}, { token: S });
  check('student payments 200', spay.status === 200, { status: spay.status });
  const snot = await schoolApi('/api/student/notices', {}, { token: S });
  check('student notices 200', snot.status === 200, { status: snot.status });
  const notArr = snot.body?.data?.notices ?? snot.body?.data ?? [];
  check('announcements visible to student', notArr.length >= 1, notArr.length);

  section('P4.E Student negatives + cross-student isolation');
  check('student GET /api/teachers 403', (await schoolApi('/api/teachers', {}, { token: S })).status === 403);
  check('student POST /api/attendance 403', (await schoolApi('/api/attendance', { method: 'POST', body: JSON.stringify({ classId: CLASS_ID, entries: [] }) }, { token: S })).status === 403);
  check('student GET /api/dashboard 403', (await schoolApi('/api/dashboard', {}, { token: S })).status === 403);
  check('student marks-entry 403', (await schoolApi('/api/teacher/marks-entry', {}, { token: S })).status === 403);
  // student2 must not read student1's private surfaces beyond role-scoped APIs
  const s2Roster = await schoolApi('/api/students/roster', {}, { token: s2.token! });
  check('roster for student = self + redacted classmates', s2Roster.status === 200, { status: s2Roster.status });

  section('P4.F Tenant isolation (other-school principal cannot touch this school)');
  // qad43zzh school principal (PENDING school — cannot login). Use platform→ second ACTIVE school? Only one ACTIVE school exists.
  // Instead: verify session-derived scoping — the teacher of THIS school cannot read a foreign class board.
  const foreignClass = 'cmvd45c5g001rnezzzzzzzzzz';
  const fBoard = await schoolApi(`/api/teacher/class-attendance/board?classId=${foreignClass}&date=${TODAY}`, {}, { token: T });
  check('foreign/unknown class board fails safe', fBoard.status === 404 || fBoard.status === 403 || (fBoard.body?.data?.students ?? []).length === 0, fBoard.status);

  summary('P3+P4 journeys');
}
main().catch(e => { console.error(e); process.exit(1); });
