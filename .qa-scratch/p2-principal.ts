import { api, schoolApi, schoolLogin, check, summary, section, RUN } from './plib';

const PRINCIPAL_EMAIL = 'qa.principal.qad45c10@qafix.scholario.dev';
const PRINCIPAL_PW = 'QaFix!2026x';
const NEW_PW = 'QaPrincipal!2026b';
const TEACHER_EMAIL = `qa.teacher.am.${RUN}@qafix.scholario.dev`;
const TEACHER_PW = 'Teach@2026x';
const ST1_EMAIL = `qa.student.arjun.${RUN}@qafix.scholario.dev`;
const ST2_EMAIL = `qa.student.meera.${RUN}@qafix.scholario.dev`;
const ST_PW = 'Stud@2026x';
const ROLL_BASE = (parseInt(RUN.slice(-3), 36) % 40) + 5;  // 5..44, stable per RUN

async function main() {
  section('P2.A Login + mandatory password change gate');
  // Re-runnable: a previous pass may have rotated the password already.
  let login = await schoolLogin(PRINCIPAL_EMAIL, NEW_PW);
  let freshCreds = false;
  if (login.status !== 200) {
    login = await schoolLogin(PRINCIPAL_EMAIL, PRINCIPAL_PW);
    freshCreds = login.status === 200;
  }
  check('principal login 200', login.status === 200, { status: login.status });
  let token = login.token!;
  if (freshCreds) {
    check('mustChangePassword true', login.body?.data?.mustChangePassword === true, login.body?.data?.mustChangePassword);
    check('entitlement ACTIVE rides login', login.body?.data?.entitlement?.businessAllowed === true, login.body?.data?.entitlement);
    const blocked = await schoolApi('/api/students', {}, { token });
    check('business API blocked pre-change (403 PASSWORD_CHANGE_REQUIRED)', blocked.status === 403 && blocked.body?.code === 'PASSWORD_CHANGE_REQUIRED', { status: blocked.status, code: blocked.body?.code });
    const ch = await schoolApi('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: PRINCIPAL_PW, newPassword: NEW_PW, confirmPassword: NEW_PW }),
    }, { token });
    check('change-password 200', ch.status === 200, { status: ch.status, body: ch.body });
    const rotated = ch.body?.data?.sessionToken;
    check('rotated sessionToken returned', typeof rotated === 'string');
    token = rotated || token;
  } else {
    console.log('  (i)    password already rotated in an earlier pass — exercising rotated path');
    check('entitlement ACTIVE rides login', login.body?.data?.entitlement?.businessAllowed === true, login.body?.data?.entitlement);
  }
  const me = await schoolApi('/api/auth/me', {}, { token });
  check('me 200 with role PRINCIPAL', me.status === 200 && me.body?.data?.user?.role === 'PRINCIPAL', { status: me.status, role: me.body?.data?.user?.role });
  if (freshCreds) {
    const reUse = await schoolApi('/api/students', {}, { token: login.token });
    check('old token dead after rotation', reUse.status === 401, { status: reUse.status });
  }

  section('P2.B Setup readiness (before)');
  const r0 = await schoolApi('/api/school/setup-readiness', {}, { token });
  check('readiness 200', r0.status === 200, r0.status);
  const sections0 = r0.body?.data?.sections ?? r0.body?.data;
  check('fees section incomplete', JSON.stringify(sections0).includes('false'), JSON.stringify(sections0).slice(0, 300));

  section('P2.C Academic year');
  const setY = await schoolApi('/api/school-settings', {
    method: 'PATCH',
    body: JSON.stringify({ identity: { academicYear: '2026-2027' } }),
  }, { token });
  check('academicYear set', setY.status === 200, { status: setY.status, body: setY.body });

  section('P2.D Classes from bootstrap');
  const cls = await schoolApi('/api/classes?counts=1', {}, { token });
  check('classes GET 200', cls.status === 200, cls.status);
  const classes = cls.body?.data?.classes ?? cls.body?.data ?? [];
  check('3 bootstrap classes', classes.length === 3, classes.map((c: any) => `${c.name}-${c.section}`));
  const g5 = classes.find((c: any) => c.name === 'Grade 5' && c.section === 'A');
  const g6a = classes.find((c: any) => c.name === 'Grade 6' && c.section === 'A');
  check('Grade 5-A found', !!g5?.id);
  check('Grade 6-A found', !!g6a?.id);

  section('P2.E Create teacher');
  const t = await schoolApi('/api/teachers', {
    method: 'POST',
    body: JSON.stringify({ name: 'QA Anita Mehta', email: TEACHER_EMAIL, password: TEACHER_PW, department: 'Mathematics' }),
  }, { token });
  check('teacher created', t.status === 200 || t.status === 201, { status: t.status, body: t.body });
  let teacher = t.body?.data?.teacher ?? t.body?.data;
  if (!teacher?.userId || t.status === 409) {
    // Creation may have landed server-side before a transport reset — re-resolve by email.
    const tlist = await schoolApi('/api/teachers', {}, { token });
    const arr = tlist.body?.data?.teachers ?? tlist.body?.data ?? [];
    teacher = arr.find((x: any) => (x.email ?? x.user?.email) === TEACHER_EMAIL) ?? teacher;
  }
  check('teacher userId returned', !!teacher?.userId, teacher);

  section('P2.F Appoint class teacher + wire subjects (CSA)');
  const ct = await schoolApi('/api/principal/academic', {
    method: 'POST',
    body: JSON.stringify({ action: 'classTeacher.set', classId: g5.id, teacherName: teacher?.name ?? 'QA Anita Mehta' }),
  }, { token });
  check('classTeacher.set 200', ct.status === 200, { status: ct.status, body: ct.body });
  for (const subjectName of ['Mathematics', 'Science']) {
    const sa = await schoolApi('/api/principal/academic', {
      method: 'POST',
      body: JSON.stringify({ action: 'subject.add', classId: g5.id, subjectName }),
    }, { token });
    check(`subject.add ${subjectName}`, sa.status === 200, { status: sa.status, body: sa.body });
  }
  const st = await schoolApi('/api/subjects', {}, { token });
  check('subjects list', st.status === 200 && (st.body?.data ?? []).length >= 2, st.status);
  const subjects = st.body?.data ?? [];

  section('P2.G Admit two students');
  const s1 = await schoolApi('/api/students', {
    method: 'POST',
    body: JSON.stringify({ name: 'QA Arjun Rao', email: ST1_EMAIL, password: ST_PW, classId: g5.id, admissionNo: `QA-ADM-${RUN}-1`, rollNo: ROLL_BASE, guardianName: 'QA Guardian One' }),
  }, { token });
  check('student1 created', s1.status === 200 || s1.status === 201, { status: s1.status, body: s1.body });
  const s2 = await schoolApi('/api/students', {
    method: 'POST',
    body: JSON.stringify({ name: 'QA Meera Iyer', email: ST2_EMAIL, password: ST_PW, classId: g5.id, admissionNo: `QA-ADM-${RUN}-2`, rollNo: ROLL_BASE + 1, guardianName: 'QA Guardian Two' }),
  }, { token });
  check('student2 created', s2.status === 200 || s2.status === 201, { status: s2.status, body: s2.body });
  let st1 = s1.body?.data, st2 = s2.body?.data;
  if (!st1?.id || s1.status === 409) {
    const roster0 = await schoolApi('/api/students', {}, { token });
    const arr0 = roster0.body?.data?.students ?? roster0.body?.data ?? [];
    st1 = arr0.find((x: any) => x.email === ST1_EMAIL) ?? st1;
  }
  if (!st2?.id || s2.status === 409) {
    const roster0 = await schoolApi('/api/students', {}, { token });
    const arr0 = roster0.body?.data?.students ?? roster0.body?.data ?? [];
    st2 = arr0.find((x: any) => x.email === ST2_EMAIL) ?? st2;
  }
  check('student ids', !!st1?.id && !!st2?.id);
  const dupRoll = await schoolApi('/api/students', {
    method: 'POST',
    body: JSON.stringify({ name: 'QA Duplicate Roll', email: `qa.dup.${RUN}@qafix.scholario.dev`, password: ST_PW, classId: g5.id, admissionNo: `QA-ADM-${RUN}-3`, rollNo: ROLL_BASE }),
  }, { token });
  check('duplicate rollNo rejected', dupRoll.status >= 400 && dupRoll.status < 500, { status: dupRoll.status, body: dupRoll.body });

  section('P2.H Fees: catalogue → structure → publish → fee → payment');
  const cat = await schoolApi('/api/fees/catalogue', {
    method: 'POST',
    body: JSON.stringify({ name: 'QA Tuition Annual', amount: 24000, category: 'TUITION', frequency: 'ANNUAL' }),
  }, { token });
  check('catalogue created', cat.status === 200 || cat.status === 201, { status: cat.status, body: cat.body });
  let catId = cat.body?.data?.id ?? cat.body?.data?.head?.id;
  if (!catId && cat.status === 400) {
    const catList = await schoolApi('/api/fees/catalogue', {}, { token });
    const catArr = Array.isArray(catList.body?.data) ? catList.body.data
      : Array.isArray(catList.body?.data?.heads) ? catList.body.data.heads
      : Array.isArray(catList.body?.data?.items) ? catList.body.data.items
      : Object.values(catList.body?.data ?? {}).find(Array.isArray) as any[] | undefined ?? [];
    catId = catArr.find((x: any) => x.name === 'QA Tuition Annual')?.id;
  }
  const str = await schoolApi('/api/fees/structures', {
    method: 'POST',
    body: JSON.stringify({
      classId: g5.id, className: g5.name, classLevel: 'Primary',
      heads: [{ catalogueId: catId, name: 'QA Tuition Annual', amount: 24000, frequency: 'ANNUAL', mandatory: true, category: 'TUITION' }],
    }),
  }, { token });
  check('structure created (draft)', str.status === 200 || str.status === 201 || str.status === 409, { status: str.status, body: str.body });
  let strId = str.body?.data?.id ?? str.body?.data?.structure?.id;
  let pub: any = null;
  if (str.status === 409) {
    // A current structure already exists for this class (earlier pass) — reuse it.
    const list = await schoolApi('/api/fees/structures', {}, { token });
    const arr = list.body?.data?.structures ?? list.body?.data ?? [];
    const cur = arr.find((x: any) => (x.classId === g5.id || x.className === g5.name) && x.status === 'current');
    if (cur?.id) { strId = cur.id; pub = { status: 200, body: { data: { reused: true } } }; }
  }
  if (!pub) {
    pub = await schoolApi(`/api/fees/structures/${strId}/publish`, { method: 'POST' }, { token });
    if (pub.status === 400 && /got current/.test(pub.body?.error ?? '')) {
      pub = { status: 200, body: { data: { alreadyCurrent: true } } };
    }
  }
  check('structure published', pub.status === 200, { status: pub.status, body: pub.body });
  const fee1 = await schoolApi('/api/fees', {
    method: 'POST',
    body: JSON.stringify({ studentId: st1.id, amount: 24000, title: 'QA Tuition Annual', type: 'TUITION' }),
  }, { token });
  check('fee row created', fee1.status === 200 || fee1.status === 201, { status: fee1.status, body: fee1.body });
  const fee1Id = fee1.body?.data?.id ?? fee1.body?.data?.fee?.id;
  const pay1 = await schoolApi('/api/fees/transactions', {
    method: 'POST',
    body: JSON.stringify({ studentId: st1.id, amount: 10000, method: 'Cash', feeId: fee1Id, note: 'QA first installment' }),
  }, { token });
  check('payment txn 1 recorded', pay1.status === 200 || pay1.status === 201, { status: pay1.status, body: pay1.body });
  const overpay = await schoolApi('/api/fees/transactions', {
    method: 'POST',
    body: JSON.stringify({ studentId: st1.id, amount: 999999, method: 'Cash', feeId: fee1Id }),
  }, { token });
  check('overpay rejected 409/422', overpay.status === 409 || overpay.status === 422, { status: overpay.status, body: overpay.body });

  section('P2.I Timetable publish (exact class names)');
  const tt = await schoolApi('/api/timetable/publish', {
    method: 'POST',
    body: JSON.stringify({ slots: [
      { day: 'Monday', period: 1, time: '08:30 AM - 09:15 AM', className: 'Grade 5', subject: 'Mathematics', teacherName: 'QA Anita Mehta', room: 'QA-R101' },
      { day: 'Monday', period: 2, time: '09:15 AM - 10:00 AM', className: 'Grade 5', subject: 'Science', teacherName: 'QA Anita Mehta', room: 'QA-R101' },
    ] }),
  }, { token });
  check('timetable published', tt.status === 200, { status: tt.status, body: tt.body });
  const ttRead = await schoolApi('/api/timetable', {}, { token });
  check('timetable slots read back', (ttRead.body?.data ?? []).length >= 2, (ttRead.body?.data ?? []).length);
  const dupTt = await schoolApi('/api/timetable/publish', {
    method: 'POST',
    body: JSON.stringify({ slots: [
      { day: 'Tuesday', period: 1, time: '08:30 AM - 09:15 AM', className: 'Grade 5', subject: 'Mathematics', teacherName: 'QA Anita Mehta', room: 'QA-R101' },
      { day: 'Tuesday', period: 1, time: '08:30 AM - 09:15 AM', className: 'Grade 5', subject: 'Science', teacherName: 'QA Anita Mehta', room: 'QA-R102' },
    ] }),
  }, { token });
  check('in-payload class conflict rejected (409)', dupTt.status === 409, { status: dupTt.status, code: dupTt.body?.code });
  // restore the canonical two slots (publish is replace-all)
  await schoolApi('/api/timetable/publish', {
    method: 'POST',
    body: JSON.stringify({ slots: [
      { day: 'Monday', period: 1, time: '08:30 AM - 09:15 AM', className: 'Grade 5', subject: 'Mathematics', teacherName: 'QA Anita Mehta', room: 'QA-R101' },
      { day: 'Monday', period: 2, time: '09:15 AM - 10:00 AM', className: 'Grade 5', subject: 'Science', teacherName: 'QA Anita Mehta', room: 'QA-R101' },
    ] }),
  }, { token });

  section('P2.J Announcement');
  const ann = await schoolApi('/api/announcements', {
    method: 'POST',
    body: JSON.stringify({ title: `QA Notice ${RUN}`, message: 'QA principal announcement for all audiences', audience: 'ALL', category: 'General' }),
  }, { token });
  check('announcement published', ann.status === 200 || ann.status === 201, { status: ann.status, body: ann.body });
  const annId = ann.body?.data?.id ?? ann.body?.data?.notification?.id;

  section('P2.K Exam lifecycle (create → marks → submit → verify → lock → declare → publish)');
  const math = subjects.find((s: any) => s.name === 'Mathematics');
  const sci = subjects.find((s: any) => s.name === 'Science');
  check('subjects resolved', !!math?.id && !!sci?.id, subjects.map((s: any) => s.name));
  const exam = await schoolApi('/api/exams', {
    method: 'POST',
    body: JSON.stringify({
      name: `QA Unit Test 1 ${RUN}`, type: 'Unit Test',
      startDate: '2026-10-20', endDate: '2026-10-21',
      classIds: [g5.id],
      subjectsByClass: { [g5.id]: [
        { subjectId: math.id, maxMarks: 100, passMarks: 33 },
        { subjectId: sci.id, maxMarks: 100, passMarks: 33 },
      ] },
    }),
  }, { token });
  check('exam created', exam.status === 200 || exam.status === 201, { status: exam.status, body: exam.body });
  const examId = exam.body?.data?.id ?? exam.body?.data?.exam?.id;
  const roster = await schoolApi('/api/students/roster', {}, { token });
  const rosterArr = roster.body?.data?.students ?? roster.body?.data ?? [];
  const classStudents = rosterArr.filter((s: any) => s.classId === g5.id || s.class?.id === g5.id);
  check('roster has my 2 students', classStudents.length >= 2, rosterArr.length);
  const marksRows = classStudents.flatMap((s: any) => [
    { classId: g5.id, subjectId: math.id, studentId: s.id ?? s.studentId, marksObtained: 88, status: 'PRESENT' },
    { classId: g5.id, subjectId: sci.id, studentId: s.id ?? s.studentId, marksObtained: 76, status: 'PRESENT' },
  ]);
  const mb = await schoolApi(`/api/exams/${examId}/marks/batch`, {
    method: 'POST',
    body: JSON.stringify({ marks: marksRows }),
  }, { token });
  check('marks batch saved', mb.status === 200, { status: mb.status, body: mb.body });
  const submit = await schoolApi(`/api/exams/${examId}/marks/submit`, { method: 'POST', body: JSON.stringify({}) }, { token });
  check('marks submitted', submit.status === 200, { status: submit.status, body: submit.body });
  const verify = await schoolApi(`/api/exams/${examId}/marks/verify`, { method: 'POST', body: JSON.stringify({}) }, { token });
  check('marks verified', verify.status === 200, { status: verify.status, body: verify.body });
  const lock = await schoolApi(`/api/exams/${examId}/marks/lock`, { method: 'POST', body: JSON.stringify({}) }, { token });
  check('marks locked', lock.status === 200, { status: lock.status, body: lock.body });
  const declare = await schoolApi(`/api/exams/${examId}/results/declare`, { method: 'POST' }, { token });
  check('results declared', declare.status === 200, { status: declare.status, body: declare.body });
  const publishExam = await schoolApi(`/api/exams/${examId}/publish`, { method: 'POST', body: JSON.stringify({ notifyStudents: true, notifyParents: true }) }, { token });
  check('exam published', publishExam.status === 200, { status: publishExam.status, body: publishExam.body });
  const examAfter = await schoolApi(`/api/exams/${examId}`, {}, { token });
  check('resultStatus Result Declared', /declared/i.test(examAfter.body?.data?.resultStatus ?? ''), examAfter.body?.data?.resultStatus);

  section('P2.L Attendance (principal bulk)');
  const att = await schoolApi('/api/attendance', {
    method: 'POST',
    body: JSON.stringify({ classId: g5.id, entries: [
      { studentId: st1.id, status: 'PRESENT' },
      { studentId: st2.id, status: 'ABSENT' },
    ] }),
  }, { token });
  check('attendance marked', att.status === 200, { status: att.status, body: att.body });

  section('P2.M Setup readiness complete + dashboard');
  const r1 = await schoolApi('/api/school/setup-readiness', {}, { token });
  const summary1 = r1.body?.data?.summary ?? r1.body?.data;
  check('requiredComplete true', summary1?.requiredComplete === true, JSON.stringify(summary1).slice(0, 400));
  const dash = await schoolApi('/api/dashboard', {}, { token });
  check('principal dashboard 200', dash.status === 200, dash.status);
  const stats = dash.body?.data?.stats;
  check('stats.students >= 2', (stats?.students ?? 0) >= 2, stats);
  check('stats.teachers >= 1', (stats?.teachers ?? 0) >= 1, stats);
  check('feesPaid > 0', (stats?.feesPaid ?? 0) > 0, stats?.feesPaid);

  section('P2.N Role negatives (principal blocked from teacher/student-only surfaces)');
  check('principal /api/teacher/dashboard 403', (await schoolApi('/api/teacher/dashboard', {}, { token })).status === 403);
  check('principal /api/student/dashboard 403', (await schoolApi('/api/student/dashboard', {}, { token })).status === 403);

  console.log('\nFIXTURE IDS:', JSON.stringify({ school: 'qad45c10', teacherUserId: teacher?.userId, teacherEmail: TEACHER_EMAIL, st1: st1?.id, st2: st2?.id, st1Email: ST1_EMAIL, st2Email: ST2_EMAIL, classId: g5?.id, examId, annId, fee1Id }));
  summary('P2 principal journey');
}
main().catch(e => { console.error(e); process.exit(1); });
