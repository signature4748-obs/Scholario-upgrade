/**
 * Scholario sandbox seed — Hawkings High School Prithvipur (demo tenant)
 * + Green Valley Public School (real tenant, unconfigured).
 *
 * Deterministic: same PRNG seed → same corpus every run.
 * Run: bun prisma/seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();

/* ── deterministic PRNG ─────────────────────────────────────────── */
let s = 20261009;
const rnd = () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const id = () => randomBytes(12).toString("hex");

/* ── helpers ────────────────────────────────────────────────────── */
const hashPw = (pw: string) => {
  const salt = "7363686f6c6172696f"; // fixed demo salt → one scrypt pass, reused
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

async function insertMany(model: any, rows: any[]) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    try { await model.createMany({ data: chunk }); }
    catch { for (const r of chunk) await model.create({ data: r }); }
  }
}

/* ── name corpus (Bundelkhand / MP flavour) ─────────────────────── */
const M = ["Aarav", "Vihaan", "Aditya", "Rohan", "Rahul", "Krishna", "Dev", "Ansh", "Kunal", "Manish", "Sumit", "Harsh", "Yash", "Nikhil", "Abhay", "Gaurav", "Kartik", "Mohit", "Sachin", "Vivek", "Deepak", "Ashutosh", "Shubham", "Ritesh", "Lokesh"];
const F = ["Ananya", "Aadya", "Diya", "Kavya", "Isha", "Siya", "Riya", "Priya", "Sneha", "Pooja", "Neha", "Shreya", "Bhavya", "Lavanya", "Mansi", "Divya", "Aarti", "Sakshi", "Muskaan", "Jyoti", "Ritu", "Simran", "Tanvi", "Ira", "Nidhi"];
const SUR = ["Sharma", "Verma", "Gupta", "Yadav", "Singh", "Tomar", "Kushwaha", "Jain", "Agarwal", "Mishra", "Tiwari", "Chaturvedi", "Dwivedi", "Pandey", "Rathore", "Baghel", "Sikarwar", "Sahu", "Rawat", "Kushwah", "Rajput", "Namdev", "Ahirwar", "Pal", "Lodhi"];
const GUARDIAN = ["Shri Rajesh", "Smt. Rekha", "Shri Mohan", "Smt. Sunita", "Shri Ramakant", "Smt. Kamla", "Shri Devendra", "Smt. Asha", "Shri Ramesh", "Smt. Geeta", "Shri Jagdish", "Smt. Meena", "Shri Balram", "Smt. Radha", "Shri Santosh", "Smt. Vimlesh"];
const phone = () => `+91 ${pick(["9", "8", "7", "6"])}${ri(0, 9)}${ri(0, 9)}${ri(0, 9)}${ri(0, 9)}${ri(0, 9)}${ri(0, 9)}${ri(0, 9)}${ri(0, 9)}${ri(0, 9)}`;

const today = new Date(); today.setHours(0, 0, 0, 0);
const DEMO_PW = "Hawkings@2026";

async function main() {
  console.log("Resetting tables…");
  const wipe = ["activityLog", "notice", "lessonPlan", "payslip", "admissionInquiry", "timetableSlot", "payment", "feeAssessment", "feeStructure", "mark", "examSubject", "exam", "attendance", "student", "classSubject", "subject", "class", "room", "teacher", "session", "user", "school"];
  for (const m of wipe) await (db as any)[m].deleteMany({});

  /* ── schools ─────────────────────────────────────────────────── */
  const hawk = await db.school.create({ data: {
    id: id(), name: "Hawkings High School Prithvipur", slug: "hawkings-prithvipur", code: "HHSP",
    shortName: "Hawkings", tagline: "Vidya Dadati Vinayam",
    address: "Station Road, Near Bus Stand, Prithvipur", city: "Distt. Niwari, Madhya Pradesh — 472336",
    phone: "07578 265432", email: "office@hhsp.edu.in",
    principalName: "Arjun Malhotra", established: "2004", board: "CBSE",
    academicYear: "2026-27", plan: "STANDARD", isDemo: true,
  }});
  await db.school.create({ data: {
    id: id(), name: "Green Valley Public School", slug: "green-valley", code: "GVPS",
    shortName: "Green Valley", address: "Civil Lines, Jhansi", city: "Uttar Pradesh",
    email: "office@greenvalley.edu.in", principalName: "R. K. Chandra",
    academicYear: "2026-27", plan: "STANDARD", isDemo: false,
  }});

  /* ── principal + teacher users ───────────────────────────────── */
  const pwHash = hashPw(DEMO_PW);
  const principalUser = await db.user.create({ data: {
    id: id(), schoolId: hawk.id, email: "arjun.malhotra@hhsp.edu.in",
    name: "Arjun Malhotra", role: "PRINCIPAL", passwordHash: pwHash,
  }});

  const T = [
    // name, subject area, designation, salary, qual, joined year
    ["Sunita Verma",        "MAT", "Senior Teacher (PGT)", 48000, "M.Sc. Mathematics, B.Ed.", 2009],
    ["Meena Sharma",        "ENG", "Senior Teacher (PGT)", 51000, "M.A. English, B.Ed.",      2007],
    ["Rakesh Yadav",        "PHY", "Teacher (PGT)",        46000, "M.Sc. Physics, B.Ed.",     2012],
    ["Deepak Chaturvedi",   "CHE", "Teacher (PGT)",        44000, "M.Sc. Chemistry, B.Ed.",   2013],
    ["Vijay Singh Rathore", "BIO", "Teacher (PGT)",        43000, "M.Sc. Botany, B.Ed.",      2015],
    ["Rekha Jain",          "CS",  "Teacher (TGT)",        42000, "MCA, B.Ed.",               2014],
    ["Kavita Tomar",        "SCI", "Teacher (TGT)",        36000, "M.Sc. (Home Sc.), B.Ed.",  2016],
    ["Anil Kushwaha",       "SST", "Teacher (TGT)",        35000, "M.A. History, B.Ed.",      2017],
    ["Prakash Chandra Gupta","HIN","Teacher (TGT)",        34000, "M.A. Hindi, B.Ed.",        2016],
    ["Mamta Tiwari",        "SAN", "Teacher (TGT)",        31000, "Shastri (Sanskrit), B.Ed.",2018],
    ["Sunil Sikarwar",      "PE",  "Sports Teacher",       28000, "B.P.Ed.",                  2015],
    ["Pooja Dwivedi",       "ENG", "Teacher (PRT)",        27000, "B.A., D.El.Ed.",           2019],
    ["Neha Agarwal",        "MAT", "Teacher (PRT)",        26000, "B.Sc., D.El.Ed.",          2020],
    ["Harish Baghel",       "MAT", "Teacher (PRT)",        25000, "B.A., D.El.Ed.",           2021],
    ["Suman Mishra",        "ART", "Art & Craft Teacher",  24000, "B.F.A.",                   2019],
    ["Arti Sahu",           "EVS", "Teacher (PRT)",        24000, "B.A., D.El.Ed.",           2022],
  ] as [string, string, string, number, string, number][];

  const teacherByArea: Record<string, any> = {};
  const teacherRows: any[] = [];
  T.forEach(([name, area, desig, salary, qual, joined], i) => {
    const uname = name.toLowerCase().replace(/ /g, ".");
    const uid = id();
    const tid = id();
    teacherRows.push({ id: uid, schoolId: hawk.id, email: `${uname}@hhsp.edu.in`, name, role: "TEACHER", passwordHash: pwHash });
    (teacherByArea[area] ||= []).push({
      id: tid, userId: uid, schoolId: hawk.id, employeeCode: `HHSP-T-${String(i + 1).padStart(3, "0")}`,
      designation: desig, qualification: qual, specialization: area,
      phone: phone(), joinedOn: new Date(`${joined}-06-15T00:00:00Z`), monthlySalary: salary,
      name, email: `${uname}@hhsp.edu.in`,
    });
  });
  // teachers need users first
  await insertMany(db.user, teacherRows.slice(0, T.length).map((u, i) => u));
  const teacherUsers = T.map(([name], i) => {
    const uname = name.toLowerCase().replace(/ /g, ".");
    return { uid: teacherRows[i].id, tid: (teacherByArea as any)[T[i][1]][ (teacherByArea as any)[T[i][1]].findIndex((x: any) => x.name === name) ].id, name, email: `${uname}@hhsp.edu.in` };
  });
  // insert teacher profile rows
  const teacherProfiles: any[] = [];
  for (const area of Object.keys(teacherByArea)) for (const t of teacherByArea[area]) teacherProfiles.push(t);
  await insertMany(db.teacher, teacherProfiles.map(({ name, email, ...t }: any) => t));

  const teacherId = (name: string) => teacherProfiles.find((t) => t.name === name)!.id;
  const teacherUserId = (name: string) => teacherProfiles.find((t) => t.name === name)?.userId ?? principalUser.id;

  /* ── rooms ───────────────────────────────────────────────────── */
  const roomRows: any[] = [];
  for (let i = 1; i <= 18; i++) roomRows.push({ id: id(), schoolId: hawk.id, code: `R-${100 + i}`, name: `Room ${100 + i}`, type: "CLASSROOM", capacity: 45, building: "Main Building", floor: i <= 8 ? "Ground" : "First" });
  for (const [code, name, cap] of [["PHYS-LAB", "Physics Laboratory", 36], ["CHE-LAB", "Chemistry Laboratory", 36], ["BIO-LAB", "Biology Laboratory", 30], ["CS-LAB", "Computer Laboratory", 32], ["LIB", "Library", 60], ["SPORTS", "Sports Room", 80]] as [string, string, number][])
    roomRows.push({ id: id(), schoolId: hawk.id, code, name, type: "LABORATORY" === "LABORATORY" ? (code === "LIB" ? "LIBRARY" : code === "SPORTS" ? "SPORTS" : "LABORATORY") : "CLASSROOM", capacity: cap, building: "Science Block", floor: "Ground" });
  await insertMany(db.room, roomRows);
  const roomByCode: Record<string, string> = {};
  roomRows.forEach((r) => (roomByCode[r.code] = r.id));

  /* ── classes ─────────────────────────────────────────────────── */
  const LEVELS: [string, number, number, string?][] = [
    ["Nursery", 0, 18], ["LKG", 1, 17], ["IKG", 2, 16],
    ["Class 1", 3, 22], ["Class 2", 4, 20], ["Class 3", 5, 19], ["Class 4", 6, 21], ["Class 5", 7, 20],
    ["Class 6", 8, 24], ["Class 6", 8, 22, "B"], ["Class 7", 9, 23], ["Class 7", 9, 21, "B"], ["Class 8", 10, 24],
    ["Class 9", 11, 26], ["Class 10", 12, 25], ["Class 11", 13, 18, "A", "Science"], ["Class 12", 14, 16, "A", "Science"],
  ];
  const classTeacherFor: Record<string, string> = {
    "Nursery": "Arti Sahu", "LKG": "Suman Mishra", "IKG": "Pooja Dwivedi",
    "Class 1": "Arti Sahu", "Class 2": "Harish Baghel", "Class 3": "Neha Agarwal",
    "Class 4": "Pooja Dwivedi", "Class 5": "Kavita Tomar", "Class 6|A": "Kavita Tomar", "Class 6|B": "Rekha Jain",
    "Class 7|A": "Prakash Chandra Gupta", "Class 7|B": "Mamta Tiwari", "Class 8": "Anil Kushwaha",
    "Class 9": "Meena Sharma", "Class 10": "Sunita Verma", "Class 11": "Rakesh Yadav", "Class 12": "Deepak Chaturvedi",
  };
  const classRows: any[] = LEVELS.map(([label, level, cap, section, stream], i) => {
    const sec = section ?? "A";
    const key = `${label}|${sec}`;
    const teacher = classTeacherFor[key] ?? classTeacherFor[label];
    return {
      id: id(), schoolId: hawk.id, gradeLevel: level + 1, section: sec, stream: stream ?? null,
      name: `${label}-${sec}`, classTeacherId: teacherId(teacher),
      roomId: roomByCode[`R-${101 + i}`], capacity: 40,
    };
  });
  await insertMany(db.class, classRows);
  const cls = (name: string) => classRows.find((c) => c.name === name)!;

  /* ── subjects ────────────────────────────────────────────────── */
  const SUBJECTS: [string, string][] = [
    ["ENG", "English"], ["HIN", "Hindi"], ["MAT", "Mathematics"], ["SCI", "Science"],
    ["SST", "Social Science"], ["SAN", "Sanskrit"], ["CS", "Computer Science"],
    ["EVS", "EVS"], ["PHY", "Physics"], ["CHE", "Chemistry"], ["BIO", "Biology"],
    ["PE", "Physical Education"], ["ART", "Art & Craft"],
  ];
  const subjectRows = SUBJECTS.map(([code, name]) => ({ id: id(), schoolId: hawk.id, code, name, fullMarks: 100, passMarks: 33 }));
  await insertMany(db.subject, subjectRows);
  const subj = (code: string) => subjectRows.find((x) => x.code === code)!;

  // curriculum per level band
  const curriculum: Record<string, string[]> = {
    primary: ["ENG", "HIN", "MAT", "EVS", "CS", "PE", "ART"],
    middle:  ["ENG", "HIN", "MAT", "SCI", "SST", "SAN", "CS", "PE"],
    sec:     ["ENG", "HIN", "MAT", "SCI", "SST", "SAN", "CS", "PE"],
    senior:  ["ENG", "PHY", "CHE", "MAT", "BIO", "CS", "PE"],
  };
  const teachFor: Record<string, string> = {
    ENG: "Meena Sharma", HIN: "Prakash Chandra Gupta", MAT: "Sunita Verma", SCI: "Kavita Tomar",
    SST: "Anil Kushwaha", SAN: "Mamta Tiwari", CS: "Rekha Jain", EVS: "Kavita Tomar",
    PHY: "Rakesh Yadav", CHE: "Deepak Chaturvedi", BIO: "Vijay Singh Rathore", PE: "Sunil Sikarwar", ART: "Suman Mishra",
  };
  const primaryTeachers: Record<string, string> = { ENG: "Pooja Dwivedi", MAT: "Neha Agarwal", EVS: "Arti Sahu", CS: "Rekha Jain", PE: "Sunil Sikarwar", ART: "Suman Mishra", HIN: "Prakash Chandra Gupta" };

  const csRows: any[] = [];
  for (const c of classRows) {
    const level = c.gradeLevel;
    const band = level <= 3 ? null : level <= 7 ? "primary" : level <= 10 ? "middle" : level <= 12 ? "sec" : "senior";
    if (!band) continue; // pre-primary: no formal subjects
    const codes = curriculum[band];
    for (const code of codes) {
      const teacher = band === "primary" && primaryTeachers[code] ? primaryTeachers[code] : teachFor[code];
      csRows.push({ id: id(), classId: c.id, subjectId: subj(code).id, teacherId: teacherId(teacher) });
    }
  }
  await insertMany(db.classSubject, csRows);

  /* ── students ────────────────────────────────────────────────── */
  const studentRows: any[] = [];
  const studentUsers: any[] = [];
  const studentMeta: any[] = [];
  let adm = 1001;
  for (const c of classRows) {
    const target = LEVELS.find((l) => `${l[0]}-${l[3] ?? "A"}` === c.name)![2];
    const level = c.gradeLevel;
    const ageBase = level + 4; // Nursery ~5, Class 12 ~17-18
    for (let r = 1; r <= target; r++) {
      const female = rnd() < 0.48;
      const first = female ? pick(F) : pick(M);
      const last = pick(SUR);
      const name = `${first} ${last}`;
      const admNo = `HHSP-2026-${adm++}`;
      const email = `${first.toLowerCase()}.${last.toLowerCase()}.${admNo.slice(-4)}@students.hhsp.edu.in`;
      const sid = id(); const uid = id();
      const dob = new Date(2026 - ageBase, ri(0, 11), ri(1, 28));
      const admYear = level >= 13 ? 2025 : level >= 8 ? ri(2021, 2025) : ri(2022, 2026);
      studentRows.push({
        id: sid, schoolId: hawk.id, userId: uid, admissionNo: admNo, rollNo: r,
        name, classId: c.id, gender: female ? "F" : "M", dob,
        guardianName: `${pick(GUARDIAN)} ${last}`, guardianPhone: phone(),
        address: `${pick(["Ward 4", "Ward 7", "Mahaveer Ganj", "Kachari Road", "Jhansi Road", "Niwari Road", "Bypass Road"])}, Prithvipur`,
        admittedOn: new Date(`${admYear}-07-01T00:00:00Z`), status: "ACTIVE",
      });
      studentUsers.push({ id: uid, schoolId: hawk.id, email, name, role: "STUDENT", passwordHash: pwHash });
      studentMeta.push({ id: sid, classId: c.id, className: c.name, ability: 0.35 + rnd() * 0.6, presence: 0.86 + rnd() * 0.13, email });
    }
  }
  // deterministic hero student for the demo door: Ananya Sharma, Class 10-A
  const heroIdx = studentRows.findIndex((st) => st.classId === cls("Class 10-A").id && st.name === "Ananya Sharma");
  if (heroIdx < 0) { // force one if the roll missed
    const uid = id(); const sid = id();
    studentRows.push({ id: sid, schoolId: hawk.id, userId: uid, admissionNo: `HHSP-2026-${adm++}`, rollNo: 25, name: "Ananya Sharma", classId: cls("Class 10-A").id, gender: "F", dob: new Date(2011, 2, 14), guardianName: "Shri Rajesh Sharma", guardianPhone: phone(), address: "Mahaveer Ganj, Prithvipur", admittedOn: new Date("2019-07-01T00:00:00Z"), status: "ACTIVE" });
    studentUsers.push({ id: uid, schoolId: hawk.id, email: "ananya.sharma.25@students.hhsp.edu.in", name: "Ananya Sharma", role: "STUDENT", passwordHash: pwHash });
    studentMeta.push({ id: sid, classId: cls("Class 10-A").id, className: "Class 10-A", ability: 0.88, presence: 0.97, email: "ananya.sharma.25@students.hhsp.edu.in" });
  } else {
    studentMeta[heroIdx].ability = 0.88; studentMeta[heroIdx].presence = 0.97;
    studentRows[heroIdx].guardianName = "Shri Rajesh Sharma"; studentRows[heroIdx].address = "Mahaveer Ganj, Prithvipur";
  }
  // two suspended students (left mid-session)
  const sus1 = studentRows.findIndex((st) => st.classId === cls("Class 8-A").id);
  const sus2 = studentRows.findIndex((st) => st.classId === cls("Class 6-B").id);
  studentRows[sus1].status = "SUSPENDED"; studentRows[sus2].status = "SUSPENDED";

  await insertMany(db.user, studentUsers);
  await insertMany(db.student, studentRows);
  console.log(`Seeded ${studentRows.length} students, ${teacherProfiles.length} teachers.`);

  /* ── attendance: last ~7 weeks + partial today ───────────────── */
  const schoolDays: string[] = [];
  for (let d = addDays(today, -49); d <= today; d = addDays(d, 1)) {
    const dow = d.getDay();
    if (dow === 0) continue;               // Sunday off
    if (iso(d) === "2026-10-02") continue; // Gandhi Jayanti
    schoolDays.push(iso(d));
  }
  const todayStr = iso(today);
  const classesMarkedToday = new Set(classRows.filter(() => rnd() < 0.6).map((c) => c.id));
  const attRows: any[] = [];
  const teacherNames = teacherProfiles.map((t) => t.name);
  for (const st of studentMeta) {
    if (studentRows.find((r) => r.id === st.id)?.status !== "ACTIVE") continue;
    for (const day of schoolDays) {
      if (day === todayStr && !classesMarkedToday.has(st.classId)) continue;
      const roll = rnd();
      const status = roll < st.presence ? "PRESENT" : roll < st.presence + 0.07 ? "ABSENT" : roll < st.presence + 0.11 ? "LATE" : "LEAVE";
      attRows.push({ id: id(), schoolId: hawk.id, studentId: st.id, classId: st.classId, date: day, status, markedById: null });
    }
  }
  await insertMany(db.attendance, attRows);
  console.log(`Seeded ${attRows.length} attendance records.`);

  /* ── exams + marks ───────────────────────────────────────────── */
  const pa1 = await db.exam.create({ data: { id: id(), schoolId: hawk.id, name: "Periodic Assessment 1 — 2026-27", term: "PA1", startsOn: "2026-09-14", endsOn: "2026-09-19", status: "PUBLISHED" } });
  const hy = await db.exam.create({ data: { id: id(), schoolId: hawk.id, name: "Half-Yearly Examination — 2026-27", term: "HALF_YEARLY", startsOn: "2026-10-26", endsOn: "2026-11-04", status: "SCHEDULED" } });

  const gradeFor = (pct: number) =>
    pct >= 91 ? "A1" : pct >= 81 ? "A2" : pct >= 71 ? "B1" : pct >= 61 ? "B2" : pct >= 51 ? "C1" : pct >= 41 ? "C2" : pct >= 35 ? "D" : pct >= 33 ? "E" : "F";

  const examSubjectRows: any[] = [];
  const markRows: any[] = [];
  for (const c of classRows) {
    const subjects = csRows.filter((x) => x.classId === c.id);
    if (!subjects.length) continue;
    // PA1: 4 core subjects; Half-Yearly: all subjects (scheduled, no marks)
    const core = subjects.slice(0, Math.min(4, subjects.length));
    for (const cs of subjects) {
      examSubjectRows.push({ id: id(), examId: hy.id, classId: c.id, subjectId: cs.subjectId, maxMarks: 100, heldOn: null });
    }
    for (const cs of core) {
      const esId = id();
      examSubjectRows.push({ id: esId, examId: pa1.id, classId: c.id, subjectId: cs.subjectId, maxMarks: 25, heldOn: "2026-09-16" });
      for (const st of studentMeta.filter((m) => m.classId === c.id)) {
        if (studentRows.find((r) => r.id === st.id)?.status !== "ACTIVE") continue;
        const noise = (rnd() - 0.5) * 0.3;
        const pct = Math.min(1, Math.max(0.15, st.ability + noise));
        const obtained = Math.max(4, Math.round(25 * pct));
        markRows.push({ id: id(), examSubjectId: esId, studentId: st.id, obtained, grade: gradeFor((obtained / 25) * 100), enteredById: teacherProfiles.find((t) => t.id === cs.teacherId)?.userId ?? principalUser.id, remarks: null });
      }
    }
  }
  await insertMany(db.examSubject, examSubjectRows);
  await insertMany(db.mark, markRows);
  console.log(`Seeded ${markRows.length} PA1 marks across ${examSubjectRows.length} exam-subject slots.`);

  /* ── fees ────────────────────────────────────────────────────── */
  const feePlan: [string, number, string, boolean][] = [
    // head, amount, frequency, mandatory — scaled per band below
  ];
  const bandFor = (c: any) => {
    const l = c.gradeLevel;
    return l <= 3 ? "pre" : l <= 7 ? "primary" : l <= 10 ? "middle" : l <= 12 ? "sec" : "senior";
  };
  const feeMatrix: Record<string, [string, number, string, boolean][]> = {
    pre:      [["Tuition Fee", 900, "MONTHLY", true], ["Activity Charges", 200, "MONTHLY", true], ["Examination Fee", 400, "ONE_TIME", true], ["Library Fund", 300, "ANNUAL", true], ["Sports Fund", 300, "ANNUAL", true]],
    primary:  [["Tuition Fee", 1100, "MONTHLY", true], ["Computer Fee", 150, "MONTHLY", true], ["Examination Fee", 500, "ONE_TIME", true], ["Library Fund", 400, "ANNUAL", true], ["Sports Fund", 400, "ANNUAL", true]],
    middle:   [["Tuition Fee", 1400, "MONTHLY", true], ["Computer Fee", 200, "MONTHLY", true], ["Examination Fee", 600, "ONE_TIME", true], ["Library Fund", 500, "ANNUAL", true], ["Sports Fund", 500, "ANNUAL", true]],
    sec:      [["Tuition Fee", 1800, "MONTHLY", true], ["Computer Fee", 250, "MONTHLY", true], ["Examination Fee", 800, "ONE_TIME", true], ["Library Fund", 600, "ANNUAL", true], ["Sports Fund", 600, "ANNUAL", true]],
    senior:   [["Tuition Fee", 2200, "MONTHLY", true], ["Computer Fee", 300, "MONTHLY", true], ["Laboratory Fee", 500, "MONTHLY", true], ["Examination Fee", 1000, "ONE_TIME", true], ["Library Fund", 700, "ANNUAL", true], ["Sports Fund", 700, "ANNUAL", true]],
  };
  const feeRows: any[] = [];
  for (const c of classRows) {
    const heads = feeMatrix[bandFor(c)];
    heads.forEach(([head, amount, frequency, mandatory], i) => {
      feeRows.push({ id: id(), schoolId: hawk.id, classId: c.id, head, amount, frequency, mandatory, sort: i });
    });
  }
  await insertMany(db.feeStructure, feeRows);

  // assessments: session months Jul..Oct for monthly heads; annual/one-time once
  const months = [["2026-07-10", "2026-07-05"], ["2026-08-10", "2026-08-05"], ["2026-09-10", "2026-09-05"], ["2026-10-10", "2026-10-05"]];
  const assessRows: any[] = [];
  const paymentRows: any[] = [];
  let receipt = 1;
  const modes = ["UPI", "UPI", "UPI", "CASH", "CASH", "BANK_TRANSFER"];
  for (const st of studentMeta) {
    const active = studentRows.find((r) => r.id === st.id)?.status === "ACTIVE";
    if (!active) continue;
    const c = classRows.find((x) => x.id === st.classId)!;
    const heads = feeRows.filter((f) => f.classId === c.id);
    const studentAssess: any[] = [];
    for (const h of heads) {
      if (h.frequency === "MONTHLY") {
        for (const [due, issued] of months) {
          const concession = rnd() < 0.06 ? Math.round(h.amount * 0.25) : 0; // sibling/staff concession for a few
          studentAssess.push({ id: id(), studentId: st.id, feeStructureId: h.id, amount: h.amount, concession, dueOn: due, status: "DUE", head: h.head, issued });
        }
      } else {
        studentAssess.push({ id: id(), studentId: st.id, feeStructureId: h.id, amount: h.amount, concession: 0, dueOn: "2026-07-15", status: "DUE", head: h.head, issued: "2026-07-05" });
      }
    }
    // payment behaviour: Jul+Aug+annual fully paid; Sep ~75%; Oct ~30%
    const paid: any[] = []; const due: any[] = [];
    for (const a of studentAssess) {
      const m = a.dueOn.slice(0, 7);
      const payProb = m <= "2026-08" ? 1 : m === "2026-09" ? 0.75 : 0.3;
      (rnd() < payProb ? paid : due).push(a);
    }
    // group paid into receipts by month
    const byMonth: Record<string, any[]> = {};
    for (const a of paid) (byMonth[a.issued] ||= []).push(a);
    for (const [issued, group] of Object.entries(byMonth)) {
      const amount = group.reduce((t: number, a: any) => t + a.amount - a.concession, 0);
      const teacherCollected = rnd() < 0.3;
      const collector = teacherCollected ? pick(teacherProfiles) : null;
      const paidOn = new Date(`${issued}T04:30:00Z`);
      paymentRows.push({
        id: id(), schoolId: hawk.id, studentId: st.id, amount,
        mode: pick(modes), receiptNo: `RCPT-2026-${String(receipt++).padStart(4, "0")}`,
        collectedById: collector ? collector.id : null,
        verifiedById: collector ? null : teacherUserId("Arjun Malhotra"),
        verifiedAt: collector ? null : paidOn,
        status: collector ? (rnd() < 0.5 ? "UNDER_VERIFICATION" : "SUCCESS") : "SUCCESS",
        note: null, paidOn,
      });
      group.forEach((a: any) => (a.status = "PAID"));
    }
    assessRows.push(...studentAssess);
  }
  await insertMany(db.feeAssessment, assessRows.map(({ head, issued, ...a }: any) => a));
  await insertMany(db.payment, paymentRows);
  console.log(`Seeded ${assessRows.length} fee assessments, ${paymentRows.length} receipts.`);

  /* ── timetable (greedy, conflict-free) ───────────────────────── */
  const busy = new Set<string>(); // teacherId|day|period
  const slotRows: any[] = [];
  for (const c of classRows) {
    const subjects = csRows.filter((x) => x.classId === c.id);
    if (!subjects.length) continue;
    const days = [1, 2, 3, 4, 5, 6];
    let cursor = ri(0, subjects.length - 1);
    for (const day of days) {
      const maxP = day === 6 ? 4 : 8; // Saturday half-day
      for (let p = 1; p <= maxP; p++) {
        if (day !== 6 && p === 5 && c.gradeLevel <= 7 && rnd() < 0.5) continue; // activity period gaps for juniors
        let placed = false;
        for (let tryN = 0; tryN < subjects.length && !placed; tryN++) {
          const cs = subjects[(cursor + tryN) % subjects.length];
          if (busy.has(`${cs.teacherId}|${day}|${p}`)) continue;
          busy.add(`${cs.teacherId}|${day}|${p}`);
          slotRows.push({ id: id(), schoolId: hawk.id, classId: c.id, dayOfWeek: day, period: p, subjectId: cs.subjectId, teacherId: cs.teacherId, roomId: c.roomId });
          cursor += tryN + 1;
          placed = true;
        }
      }
    }
  }
  await insertMany(db.timetableSlot, slotRows);
  console.log(`Seeded ${slotRows.length} timetable slots.`);

  /* ── admission inquiries ─────────────────────────────────────── */
  const inqNames = ["Aarohi Nigam", "Divyansh Kushwah", "Anvi Rajput", "Ayaan Mondal", "Nayra Bhadauria", "Krish Agrawal", "Myra Sharma", "Reyansh Tomar", "Aisha Khan", "Ved Bundela", "Pari Chandel", "Arnav Singh"];
  const inqStatus = ["NEW", "NEW", "CONTACTED", "CONTACTED", "VISIT_SCHEDULED", "VISIT_SCHEDULED", "APPLICATION", "ENROLLED", "CLOSED", "NEW", "CONTACTED", "APPLICATION"];
  const inqClass = ["Nursery", "Nursery", "LKG", "Class 1", "Class 1", "Class 3", "Class 6", "Class 6", "Class 8", "Class 9", "Class 11", "Class 11"];
  const inqSource = ["WALK_IN", "WEBSITE", "PHONE", "REFERRAL", "WEBSITE", "WALK_IN", "WEBSITE", "WALK_IN", "PHONE", "REFERRAL", "WEBSITE", "WALK_IN"];
  const inqRows = inqNames.map((applicant, i) => ({
    id: id(), schoolId: hawk.id, applicantName: applicant, classSought: inqClass[i],
    parentName: `${pick(GUARDIAN)} ${applicant.split(" ")[1]}`, phone: phone(),
    email: rnd() < 0.6 ? `enquire.${applicant.split(" ")[0].toLowerCase()}@gmail.com` : null,
    source: inqSource[i], status: inqStatus[i],
    note: i === 4 ? "Father runs a pharmacy near the bus stand; wants campus visit with transport route map."
      : i === 6 ? "Transfer case from Kendriya Vidyalaya Jhansi; needs TC verification."
      : i === 7 ? "Enrolled — seat confirmed against RCPT-2026-0288."
      : null,
    followUpOn: ["NEW", "CONTACTED", "VISIT_SCHEDULED"].includes(inqStatus[i]) ? iso(addDays(today, ri(1, 9))) : null,
    createdAt: addDays(today, -ri(1, 26)),
  }));
  await insertMany(db.admissionInquiry, inqRows);

  /* ── payslips for September 2026 ─────────────────────────────── */
  const slipRows = teacherProfiles.map((t) => {
    const gross = t.monthlySalary;
    const deductions = Math.min(gross * 0.12, 1800 > gross * 0.12 ? gross * 0.12 : 1800) + 200; // EPF + PT
    return { id: id(), schoolId: hawk.id, teacherId: t.id, month: "2026-09", gross, deductions: Math.round(deductions), net: gross - Math.round(deductions), status: "PAID", paidOn: new Date("2026-10-01T10:00:00Z") };
  });
  await insertMany(db.payslip, slipRows);

  /* ── lesson plans (this week) ────────────────────────────────── */
  const lessonTopics: [string, string, string][] = [
    ["Sunita Verma", "Class 10-A", "Quadratic equations — word problems"],
    ["Sunita Verma", "Class 10-A", "AP: sum of first n terms"],
    ["Sunita Verma", "Class 9-A", "Polynomials — remainder theorem"],
    ["Meena Sharma", "Class 10-A", "The Ball Poem — imagery & tone"],
    ["Meena Sharma", "Class 9-A", "Letter writing (formal) — format drill"],
    ["Rakesh Yadav", "Class 11-A", "Laws of motion — problem set 3.4"],
    ["Deepak Chaturvedi", "Class 12-A", "Aldehydes & ketones — tollens test"],
    ["Kavita Tomar", "Class 6-A", "Food sources — where does it come from?"],
    ["Anil Kushwaha", "Class 8-A", "The Revolt of 1857 — causes map"],
    ["Rekha Jain", "Class 10-A", "HTML tables — timetable project"],
    ["Prakash Chandra Gupta", "Class 7-A", "Kabir ke dohe — arth vyakhya"],
    ["Mamta Tiwari", "Class 8-A", "Shlok uccharan — GIT-1 practice"],
    ["Sunil Sikarwar", "Class 9-A", "Kabaddi — raiding footwork drill"],
    ["Suman Mishra", "LKG-A", "Finger painting — autumn leaves"],
  ];
  const lessonRows = lessonTopics.map(([teacher, className, topic], i) => {
    const c = cls(className);
    const subjectId = csRows.find((x) => x.classId === c.id && x.teacherId === teacherId(teacher))?.subjectId ?? subj("MAT").id;
    return {
      id: id(), schoolId: hawk.id, teacherId: teacherId(teacher), classId: c.id, subjectId,
      topic, objectives: "Recap previous concept, introduce the day's topic, guided practice, exit question.",
      materials: i % 3 === 0 ? "Board, NCERT textbook, worksheet" : "Board, NCERT textbook",
      date: iso(addDays(today, -ri(0, 4))), periods: ri(1, 2),
      status: i < 8 ? "TAUGHT" : "DRAFT",
    };
  });
  await insertMany(db.lessonPlan, lessonRows);

  /* ── notices ─────────────────────────────────────────────────── */
  const noticeRows = [
    ["Half-Yearly Examination — 26 Oct to 4 Nov", "The datesheet for the Half-Yearly Examination (2026-27) is published. Examinations begin Monday, 26 October and conclude Wednesday, 4 November. School disperses at 11:40 AM on exam days. Admit cards will be issued from 22 October against cleared fee dues.", "ALL", true],
    ["Vijayadashami holiday — 20 October", "The school remains closed on Tuesday, 20 October on account of Vijayadashami. Regular classes resume Wednesday, 21 October.", "ALL", false],
    ["Term 2 fee reminder", "Term 2 fee (October) is due by 10 October. Kindly clear dues at the school office or via UPI on the notice board QR. Receipts are issued the same day; exam admit cards require cleared dues.", "ALL", false],
    ["Parent-Teacher Meeting — Saturday, 14 November", "PTM for Classes Nursery to 12 will be held on Saturday, 14 November from 10:00 AM to 1:00 PM. Class teachers will share PA1 performance and half-yearly preparation plans. Attendance of at least one guardian is expected.", "ALL", false],
    ["Inter-house cricket trials — 17 October", "Trials for the inter-house cricket tournament (U-14 and U-17) will be held on the sports ground, Saturday, 17 October at 4:00 PM. Bring your own kit.", "STUDENTS", false],
    ["Science exhibition — registrations open", "Students of Classes 9 to 12 may register for the district science exhibition with their science teachers by 24 October. Working models in groups of up to three.", "STUDENTS", false],
    ["Staff meeting — Monday, 12 October", "Monthly staff meeting in the Library at 1:40 PM (after period 8). Agenda: half-yearly invigilation duty, datesheet distribution and fee verification backlog.", "TEACHERS", false],
  ].map(([title, body, audience, pinned], i) => ({
    id: id(), schoolId: hawk.id, title: title as string, body: body as string, audience: audience as string,
    pinned: pinned as boolean, postedById: principalUser.id, publishedAt: addDays(today, -i * 2 - 1),
  }));
  await insertMany(db.notice, noticeRows);

  /* ── activity log ────────────────────────────────────────────── */
  const actRows = [
    ["Marks published", "PA1 results published for Class 10-A (Mathematics)", "Sunita Verma", "TEACHER"],
    ["Fee verified", "Receipt RCPT-2026-0341 (₹3,900) verified — Ananya Sharma, Class 10-A", "Arjun Malhotra", "PRINCIPAL"],
    ["Attendance", "Daily attendance submitted for Class 8-A", "Anil Kushwaha", "TEACHER"],
    ["Admissions", "New inquiry — Class 6 (Nayra Bhadauria, referral)", "Arjun Malhotra", "PRINCIPAL"],
    ["Salary", "September 2026 payslips processed for 16 staff", "Arjun Malhotra", "PRINCIPAL"],
    ["Notice", "Half-Yearly datesheet notice published", "Arjun Malhotra", "PRINCIPAL"],
    ["Fee collected", "₹1,950 collected via UPI — Dev Agarwal, Class 7-A", "Rekha Jain", "TEACHER"],
    ["Timetable", "Timetable revised for Class 11-A (period 6 swap)", "Arjun Malhotra", "PRINCIPAL"],
    ["Marks entry", "PA1 marks entered for Class 9-A (Science)", "Kavita Tomar", "TEACHER"],
    ["Student", "Anvi Rajput enrolled from inquiry — Class 6-A, roll no. 25", "Arjun Malhotra", "PRINCIPAL"],
    ["Lesson plan", "Lesson plan submitted — 'The Revolt of 1857', Class 8-A", "Anil Kushwaha", "TEACHER"],
    ["Fee verification", "8 teacher-collected receipts verified for 6-Oct window", "Arjun Malhotra", "PRINCIPAL"],
  ].map(([action, detail, actorName, actorRole], i) => ({
    id: id(), schoolId: hawk.id, actorName: actorName as string, actorRole: actorRole as string,
    action: action as string, detail: detail as string, createdAt: addDays(today, -0.2 * i),
  }));
  await insertMany(db.activityLog, actRows);

  /* ── Green Valley (real tenant — principal only, unconfigured) ─ */
  const gv = await db.school.findUnique({ where: { slug: "green-valley" } });
  await db.user.create({ data: { id: id(), schoolId: gv!.id, email: "principal@greenvalley.edu.in", name: "R. K. Chandra", role: "PRINCIPAL", passwordHash: hashPw("GreenValley@2026") } });

  console.log("\n✅ Seed complete:");
  console.log("   Demo tenant: hawkings-prithvipur");
  console.log("   Principal:  arjun.malhotra@hhsp.edu.in / Hawkings@2026");
  console.log("   Teacher:    sunita.verma@hhsp.edu.in / Hawkings@2026");
  console.log(`   Student:    ananya.sharma.${studentRows.find((r: any) => r.name === "Ananya Sharma")?.rollNo ?? 25}@students.hhsp.edu.in / Hawkings@2026`);
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
