#!/usr/bin/env node
// Generates users.csv and user-source-role-assignments.csv for the manufacturing-s4hana demo pack.
// Target: ~1,000 users (101–1000 new, 001–100 preserved).
// Run from the repo root: node airm/data/demos/manufacturing-s4hana/generate.mjs

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────
// Name pools (Germanic, realistic manufacturing workforce)
// ─────────────────────────────────────────────────────────────────

const MALE_FIRST = [
  "Richard","Thomas","Michael","Frank","Peter","Hans","Juergen","Stefan","Martin","Klaus",
  "Andreas","Ralf","Dirk","Bernd","Joerg","Wolfgang","Helmut","Christoph","Gerd","Herbert",
  "Manfred","Lothar","Norbert","Uwe","Dieter","Kurt","Werner","Heinz","Karl","Erwin",
  "Hermann","Armin","Fritz","Otto","Georg","Paul","Siegfried","Max","Alfred","Gerhard",
  "Walter","Friedrich","Reinhard","Erich","Rainer","Detlef","Bernhard","Horst","Konrad","Wilfried",
  "Axel","Burkhard","Carsten","Eduard","Florian","Guenter","Harald","Ingo","Jochen","Lars",
  "Lutz","Markus","Olaf","Patrick","Rolf","Stephan","Ulrich","Volker","Willi","Anton",
  "Boris","Claus","Dietmar","Ernst","Felix","Gunnar","Heinrich","Ivan","Josef","Kevin",
  "Leon","Marco","Nico","Oscar","Philipp","Rene","Simon","Tobias","Uwe","Viktor",
  "Wilhelm","Xaver","Yannick","Zoltan","Adam","Bruno","Cedric","Dario","Elmar","Fabian",
];

const FEMALE_FIRST = [
  "Angela","Sandra","Christina","Heike","Monika","Claudia","Petra","Gabriele","Ursula","Birgit",
  "Sabine","Karin","Anja","Elke","Marion","Ingrid","Barbara","Renate","Ulrike","Brigitte",
  "Erika","Doris","Hannelore","Elfriede","Christa","Gudrun","Ilse","Gerda","Hildegard","Margot",
  "Gertrude","Helga","Edith","Lieselotte","Irmgard","Waltraud","Rosemarie","Elisabeth","Anneliese","Ruth",
  "Margarete","Anni","Katharina","Hilde","Ingeborg","Renata","Evelyn","Anita","Gisela","Astrid",
  "Beate","Cornelia","Dagmar","Frauke","Gitta","Hanna","Irene","Judith","Karen","Lena",
  "Maria","Natalie","Olivia","Sonja","Tanja","Veronika","Wibke","Yvonne","Antje","Carmen",
  "Diana","Eva","Franziska","Greta","Hedwig","Iris","Janine","Kristina","Lisa","Martina",
  "Nicole","Ortrud","Pauline","Qurina","Rita","Silke","Traude","Uschi","Verena","Walburga",
  "Xenia","Yvette","Zara","Amelie","Britt","Celina","Dina","Elena","Franziska","Gunda",
];

const LAST = [
  "Bauer","Fischer","Muller","Weber","Schneider","Wagner","Becker","Hoffmann","Schaefer","Koch",
  "Richter","Klein","Wolf","Neumann","Schwarz","Braun","Zimmermann","Krueger","Hartmann","Lange",
  "Werner","Schmitt","Meier","Lehmann","Schmid","Schulz","Maier","Huber","Kaiser","Fuchs",
  "Peters","Scholz","Roth","Schreiber","Vogel","Friedrich","Keller","Koenig","Mueller","Haas",
  "Ludwig","Busch","Heinrich","Seidel","Brandt","Graf","Pohl","Kuhn","Engel","Horn",
  "Sauer","Vogt","Sommer","Winter","Hauser","Wolff","Berger","Pfeiffer","Franke","Lang",
  "Kraus","Baumann","Simon","Schuster","Lorenz","Boehm","Dietrich","Kuehne","Schubert","Beckmann",
  "Hahn","Kruse","Voigt","Reuter","Jansen","Lindner","Winkler","Steiner","Albrecht","Ritter",
  "Arnold","Herrmann","Kock","Stark","Grimm","Lenz","Weiss","Hoppe","Kraft","Moser",
  "Guenther","Krug","Fiedler","Wendt","Grosse","Pfeffer","Kunze","Stein","Bergmann","Adler",
  "Bach","Berg","Christ","Dorn","Falk","Goll","Hardt","Imhof","Jung","Kern",
  "Link","Mann","Nagel","Ott","Ring","Sand","Thal","Uhlig","Voss","Wahl",
  "Abel","Brand","Cord","Damm","Eck","Fuhr","Glas","Hess","Jost","Kamp",
  "Laub","Menk","Nett","Ohl","Rau","Sixt","Tost","Uhl","Veit","Weis",
  "Zahn","Adam","Blank","Conrad","Decker","Ebert","Faber","Gerber","Hansen","Irmer",
  "Jacob","Kiefer","Lauer","Maas","Naumann","Oppermann","Probst","Quast","Rose","Sauer",
];

// ─────────────────────────────────────────────────────────────────
// Department profiles: { dept, count, jobTitles[], roleFn }
// roleFn(jobTitle) → string[]  (source role IDs)
// ─────────────────────────────────────────────────────────────────

function prodRoles(title) {
  if (/supervisor|manager|team lead|shift lead|controller/i.test(title)) return ["ZPP_SUPERVISOR"];
  if (/planner|scheduler|engineer|analyst|coordinator/i.test(title)) return ["ZPP_PLANNER"];
  return ["ZPP_OPERATOR"];
}

function qualityRoles(title) {
  if (/manager/i.test(title)) return ["ZQM_MANAGER", "ZQM_AUDITOR"];
  if (/auditor/i.test(title)) return ["ZQM_AUDITOR"];
  if (/engineer/i.test(title)) return ["ZQM_INSPECTOR", "ZQM_MANAGER"];
  return ["ZQM_INSPECTOR"];
}

function maintRoles(title) {
  if (/manager|engineer|reliability/i.test(title)) return ["ZPM_PLANNER", "ZPM_ENGINEER"];
  if (/planner|coordinator|administrator/i.test(title)) return ["ZPM_PLANNER"];
  return ["ZPM_TECHNICIAN"];
}

function scRoles(title) {
  if (/director|vice|head/i.test(title)) return ["ZMM_BUYER", "ZPP_PLANNER"];
  if (/logistics|shipping/i.test(title)) return ["ZSD_SHIPPING", "ZMM_HANDLER"];
  if (/vendor|supplier/i.test(title)) return ["ZMM_BUYER", "ZFI_AP"];
  return ["ZMM_BUYER"];
}

function whRoles(title) {
  if (/manager/i.test(title)) return ["ZMM_WAREHOUSE", "ZMM_INVENTORY"];
  if (/supervisor/i.test(title)) return ["ZMM_WAREHOUSE"];
  if (/inventory|counter|analyst/i.test(title)) return ["ZMM_INVENTORY", "ZMM_HANDLER"];
  if (/shipping|coordinator/i.test(title)) return ["ZSD_SHIPPING", "ZMM_HANDLER"];
  return ["ZMM_HANDLER"];
}

function engRoles(title) {
  if (/manager|director/i.test(title)) return ["ZPP_SUPERVISOR", "ZPP_PLANNER"];
  if (/automation|systems/i.test(title)) return ["ZPP_PLANNER", "ZIT_BASIS"];
  return ["ZPP_PLANNER"];
}

function ehsRoles(title) {
  if (/compliance|auditor|manager/i.test(title)) return ["ZEHS_COORD", "ZQM_AUDITOR"];
  return ["ZEHS_COORD"];
}

function hrRoles(title) {
  if (/payroll/i.test(title)) return ["ZHR_ADMIN", "ZFI_AP"];
  return ["ZHR_ADMIN"];
}

function finRoles(title) {
  if (/manager|controller|director/i.test(title)) return ["ZFI_GL", "ZFI_COST"];
  if (/ap|payable|invoice/i.test(title)) return ["ZFI_AP"];
  if (/cost|budget|product/i.test(title)) return ["ZFI_COST"];
  return ["ZFI_GL"];
}

function itRoles(_title) {
  return ["ZIT_BASIS"];
}

const DEPT_PROFILES = [
  {
    dept: "Production",
    count: 220,
    titles: [
      "Production Supervisor","Production Planner","Shop Floor Manager","MES Operator",
      "Production Scheduler","Process Engineer","Production Team Lead","Assembly Line Supervisor",
      "Production Operator","Shift Lead","Production Controller","Line Technician",
      "Production Analyst","Manufacturing Coordinator","Machining Operator","Press Operator",
      "Welding Technician","Paint Line Operator","CNC Operator","Assembly Technician",
    ],
    roleFn: prodRoles,
  },
  {
    dept: "Quality",
    count: 90,
    titles: [
      "Quality Manager","Quality Inspector","QA Engineer","Incoming Quality Inspector",
      "Quality Lab Technician","Quality Auditor","Quality Data Analyst","SPC Analyst",
      "Quality Coordinator","Metrology Technician","Failure Analysis Engineer","Quality Systems Specialist",
    ],
    roleFn: qualityRoles,
  },
  {
    dept: "Maintenance",
    count: 90,
    titles: [
      "Maintenance Manager","Maintenance Planner","Maintenance Technician","Reliability Engineer",
      "Preventive Maintenance Coordinator","CMMS Administrator","Calibration Technician",
      "Maintenance Supervisor","Electrical Technician","Mechanical Technician",
      "Instrument Technician","Maintenance Engineer",
    ],
    roleFn: maintRoles,
  },
  {
    dept: "Supply Chain",
    count: 90,
    titles: [
      "Supply Chain Director","Supply Chain Planner","Demand Planner","MRP Controller",
      "Procurement Specialist","Supply Chain Analyst","Logistics Coordinator","Purchasing Agent",
      "Vendor Manager","Supplier Quality Engineer","Expeditor","Category Manager",
    ],
    roleFn: scRoles,
  },
  {
    dept: "Warehouse",
    count: 120,
    titles: [
      "Warehouse Manager","Warehouse Supervisor","Material Handler","Inventory Analyst",
      "Receiving Clerk","Shipping Coordinator","Forklift Operator","Cycle Counter",
      "Warehouse Clerk","Inventory Controller","Dock Supervisor","Returns Handler",
    ],
    roleFn: whRoles,
  },
  {
    dept: "Engineering",
    count: 70,
    titles: [
      "Manufacturing Engineer","Process Engineer","Industrial Engineer","Tool Engineer",
      "Design Engineer","Methods Engineer","Automation Engineer","CAD Designer",
      "Engineering Manager","Project Engineer","Systems Engineer","R&D Engineer",
    ],
    roleFn: engRoles,
  },
  {
    dept: "EHS",
    count: 45,
    titles: [
      "EHS Manager","EHS Coordinator","Safety Inspector","Environmental Specialist",
      "Occupational Health Technician","EHS Data Analyst","Waste Management Coordinator",
      "EHS Compliance Specialist","Fire Safety Officer","EHS Trainer",
    ],
    roleFn: ehsRoles,
  },
  {
    dept: "HR",
    count: 55,
    titles: [
      "HR Manager","HR Business Partner","Payroll Administrator","Training Coordinator",
      "Recruiter","HR Administrator","Benefits Administrator","Time and Attendance Clerk",
      "Labor Relations Specialist","HR Analyst","Talent Acquisition Specialist","HR Generalist",
    ],
    roleFn: hrRoles,
  },
  {
    dept: "Finance",
    count: 70,
    titles: [
      "Finance Manager","Cost Accountant","AP Specialist","AR Specialist",
      "Financial Analyst","GL Accountant","Controller","Budget Analyst",
      "Tax Accountant","Finance Clerk","Plant Controller","Treasury Analyst",
    ],
    roleFn: finRoles,
  },
  {
    dept: "IT",
    count: 50,
    titles: [
      "IT Manager","SAP Basis Administrator","Network Administrator","Help Desk Analyst",
      "Application Support Analyst","IT Security Analyst","SAP Developer","Data Analyst",
      "Systems Administrator","IT Project Manager","Database Administrator","Business Analyst",
    ],
    roleFn: itRoles,
  },
];

// Verify new users total = 900 (existing 100 + 900 new = 1000 total)
const total = DEPT_PROFILES.reduce((s, d) => s + d.count, 0);
if (total !== 900) throw new Error(`Dept count mismatch: ${total} (expected 900 new users)`);

// ─────────────────────────────────────────────────────────────────
// Name generation — deterministic enough, collision-resistant
// ─────────────────────────────────────────────────────────────────

const usedEmails = new Set();
const usedNames = new Set();

function pickName(idx) {
  // Alternate male/female based on index for realistic gender mix
  const isFemale = idx % 3 === 1; // ~33% female, ~67% male (manufacturing skew)
  const pool = isFemale ? FEMALE_FIRST : MALE_FIRST;
  const firstIdx = idx % pool.length;
  const lastIdx = idx % LAST.length;
  let firstName = pool[firstIdx];
  let lastName = LAST[lastIdx];

  // Collision avoidance: suffix last name with dept abbreviation if needed
  let name = `${firstName} ${lastName}`;
  let attempt = 0;
  while (usedNames.has(name) && attempt < 20) {
    attempt++;
    lastName = LAST[(lastIdx + attempt * 7) % LAST.length];
    name = `${firstName} ${lastName}`;
  }
  usedNames.add(name);
  return { firstName, lastName, displayName: name };
}

function makeEmail(firstName, lastName) {
  const base = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@mfgcorp.com`
    .replace(/ü/g, "ue").replace(/ö/g, "oe").replace(/ä/g, "ae").replace(/ß/g, "ss")
    .replace(/&/g, "and").replace(/\s+/g, "").replace(/[^a-z0-9.@]/g, "");
  let email = base;
  let n = 2;
  while (usedEmails.has(email)) {
    email = base.replace("@", `${n}@`);
    n++;
  }
  usedEmails.add(email);
  return email;
}

// ─────────────────────────────────────────────────────────────────
// Generate new users (MF101 – MF1000)
// ─────────────────────────────────────────────────────────────────

// Seed usedNames/usedEmails with existing 100
const EXISTING_100 = [
  ["Richard","Bauer"],["Angela","Fischer"],["Thomas","Muller"],["Sandra","Weber"],
  ["Michael","Schneider"],["Christina","Wagner"],["Frank","Becker"],["Heike","Hoffmann"],
  ["Peter","Schaefer"],["Monika","Koch"],["Hans","Richter"],["Claudia","Klein"],
  ["Juergen","Wolf"],["Petra","Neumann"],["Stefan","Schwarz"],["Gabriele","Braun"],
  ["Martin","Zimmermann"],["Ursula","Krueger"],["Klaus","Hartmann"],["Birgit","Lange"],
  ["Andreas","Werner"],["Sabine","Schmitt"],["Ralf","Meier"],["Karin","Lehmann"],
  ["Dirk","Schmid"],["Anja","Schulz"],["Bernd","Maier"],["Elke","Huber"],
  ["Joerg","Kaiser"],["Marion","Fuchs"],["Wolfgang","Peters"],["Ingrid","Scholz"],
  ["Helmut","Roth"],["Barbara","Schreiber"],["Christoph","Vogel"],["Renate","Friedrich"],
  ["Gerd","Keller"],["Ulrike","Koenig"],["Herbert","Mueller"],["Brigitte","Haas"],
  ["Manfred","Ludwig"],["Erika","Busch"],["Lothar","Heinrich"],["Doris","Seidel"],
  ["Norbert","Brandt"],["Hannelore","Graf"],["Uwe","Pohl"],["Elfriede","Kuhn"],
  ["Dieter","Engel"],["Christa","Horn"],["Kurt","Sauer"],["Gudrun","Bauer"],
  ["Werner","Vogt"],["Ilse","Sommer"],["Heinz","Winter"],["Gerda","Hauser"],
  ["Karl","Wolff"],["Hildegard","Berger"],["Erwin","Pfeiffer"],["Margot","Franke"],
  ["Hermann","Lang"],["Gertrude","Kraus"],["Armin","Baumann"],["Helga","Simon"],
  ["Fritz","Schuster"],["Edith","Lorenz"],["Otto","Boehm"],["Lieselotte","Dietrich"],
  ["Georg","Kuehne"],["Irmgard","Schubert"],["Paul","Beckmann"],["Waltraud","Hahn"],
  ["Siegfried","Kruse"],["Rosemarie","Voigt"],["Max","Reuter"],["Elisabeth","Jansen"],
  ["Alfred","Lindner"],["Anneliese","Winkler"],["Gerhard","Steiner"],["Ruth","Albrecht"],
  ["Walter","Ritter"],["Margarete","Arnold"],["Friedrich","Herrmann"],["Anni","Kock"],
  ["Reinhard","Stark"],["Katharina","Grimm"],["Erich","Lenz"],["Hilde","Weiss"],
  ["Rainer","Hoppe"],["Ingeborg","Kraft"],["Detlef","Moser"],["Renata","Guenther"],
  ["Bernhard","Krug"],["Evelyn","Fiedler"],["Horst","Wendt"],["Hannelore","Grosse"],
  ["Konrad","Pfeffer"],["Anita","Kunze"],["Wilfried","Stein"],["Gisela","Bergmann"],
];

for (const [fn, ln] of EXISTING_100) {
  usedNames.add(`${fn} ${ln}`);
  usedEmails.add(`${fn.toLowerCase()}.${ln.toLowerCase()}@mfgcorp.com`);
}

// Source → Target role mapping (derived from existing 100-user file)
const SOURCE_TO_TARGET = {
  ZPP_SUPERVISOR: "S4_PP_SUPERVISOR",
  ZPP_PLANNER:    "S4_PP_PLANNER",
  ZPP_OPERATOR:   "S4_MES_OPERATOR",
  ZQM_INSPECTOR:  "S4_QM_INSPECTOR",
  ZQM_MANAGER:    "S4_QM_MANAGER",
  ZQM_AUDITOR:    "S4_QM_AUDITOR",
  ZPM_PLANNER:    "S4_PM_PLANNER",
  ZPM_TECHNICIAN: "S4_PM_TECHNICIAN",
  ZPM_ENGINEER:   "S4_PM_ENGINEER",
  ZMM_HANDLER:    "S4_MM_HANDLER",
  ZMM_BUYER:      "S4_MM_PURCHASER",
  ZMM_WAREHOUSE:  "S4_MM_WAREHOUSE",
  ZMM_INVENTORY:  "S4_MM_INVENTORY",
  ZSD_SHIPPING:   "S4_SD_SHIPPING",
  ZFI_COST:       "S4_FI_COST",
  ZFI_AP:         "S4_FI_AP",
  ZFI_GL:         "S4_FI_GL",
  ZEHS_COORD:     "S4_EHS_SPECIALIST",
  ZHR_ADMIN:      null,  // HR out of scope for S/4HANA role migration
  ZIT_BASIS:      null,  // IT basis out of scope
};

const newUsers = [];
const newAssignments = [];
const newTargetAssignments = [];

let idx = 0;
let userNum = 101;

for (const profile of DEPT_PROFILES) {
  const titles = profile.titles;
  for (let i = 0; i < profile.count; i++) {
    const id = `MF${String(userNum).padStart(3, "0")}`;
    const { firstName, lastName, displayName } = pickName(idx);
    const email = makeEmail(firstName, lastName);
    const title = titles[i % titles.length];

    newUsers.push({ id, displayName, email, title, dept: profile.dept });

    const roles = profile.roleFn(title);
    for (const role of roles) {
      newAssignments.push({ userId: id, roleId: role });
      const targetRole = SOURCE_TO_TARGET[role];
      if (targetRole) {
        // Deduplicate: a user might get the same target from two source roles
        const key = `${id}:${targetRole}`;
        if (!newTargetAssignments.find(a => `${a.userId}:${a.roleId}` === key)) {
          newTargetAssignments.push({ userId: id, roleId: targetRole });
        }
      }
    }

    userNum++;
    idx++;
  }
}

// ─────────────────────────────────────────────────────────────────
// Write users.csv (append-only: preserve existing 100, add 900)
// ─────────────────────────────────────────────────────────────────

// Existing 100 rows (verbatim from original)
const existingUserRows = `MF001,Richard Bauer,richard.bauer@mfgcorp.com,Production Supervisor,Production
MF002,Angela Fischer,angela.fischer@mfgcorp.com,Production Planner,Production
MF003,Thomas Muller,thomas.muller@mfgcorp.com,Shop Floor Manager,Production
MF004,Sandra Weber,sandra.weber@mfgcorp.com,MES Operator,Production
MF005,Michael Schneider,michael.schneider@mfgcorp.com,Production Scheduler,Production
MF006,Christina Wagner,christina.wagner@mfgcorp.com,Process Engineer,Production
MF007,Frank Becker,frank.becker@mfgcorp.com,Production Team Lead,Production
MF008,Heike Hoffmann,heike.hoffmann@mfgcorp.com,Assembly Line Supervisor,Production
MF009,Peter Schaefer,peter.schaefer@mfgcorp.com,Production Operator,Production
MF010,Monika Koch,monika.koch@mfgcorp.com,Shift Lead,Production
MF011,Hans Richter,hans.richter@mfgcorp.com,Quality Manager,Quality
MF012,Claudia Klein,claudia.klein@mfgcorp.com,Quality Inspector,Quality
MF013,Juergen Wolf,juergen.wolf@mfgcorp.com,QA Engineer,Quality
MF014,Petra Neumann,petra.neumann@mfgcorp.com,Quality Inspector,Quality
MF015,Stefan Schwarz,stefan.schwarz@mfgcorp.com,Incoming Quality Inspector,Quality
MF016,Gabriele Braun,gabriele.braun@mfgcorp.com,Quality Lab Technician,Quality
MF017,Martin Zimmermann,martin.zimmermann@mfgcorp.com,Quality Auditor,Quality
MF018,Ursula Krueger,ursula.krueger@mfgcorp.com,Quality Data Analyst,Quality
MF019,Klaus Hartmann,klaus.hartmann@mfgcorp.com,SPC Analyst,Quality
MF020,Birgit Lange,birgit.lange@mfgcorp.com,Quality Inspector,Quality
MF021,Andreas Werner,andreas.werner@mfgcorp.com,Maintenance Manager,Maintenance
MF022,Sabine Schmitt,sabine.schmitt@mfgcorp.com,Maintenance Planner,Maintenance
MF023,Ralf Meier,ralf.meier@mfgcorp.com,Maintenance Technician,Maintenance
MF024,Karin Lehmann,karin.lehmann@mfgcorp.com,Reliability Engineer,Maintenance
MF025,Dirk Schmid,dirk.schmid@mfgcorp.com,Maintenance Technician,Maintenance
MF026,Anja Schulz,anja.schulz@mfgcorp.com,Preventive Maintenance Coordinator,Maintenance
MF027,Bernd Maier,bernd.maier@mfgcorp.com,Maintenance Technician,Maintenance
MF028,Elke Huber,elke.huber@mfgcorp.com,CMMS Administrator,Maintenance
MF029,Joerg Kaiser,joerg.kaiser@mfgcorp.com,Calibration Technician,Maintenance
MF030,Marion Fuchs,marion.fuchs@mfgcorp.com,Maintenance Supervisor,Maintenance
MF031,Wolfgang Peters,wolfgang.peters@mfgcorp.com,Supply Chain Director,Supply Chain
MF032,Ingrid Scholz,ingrid.scholz@mfgcorp.com,Supply Chain Planner,Supply Chain
MF033,Helmut Roth,helmut.roth@mfgcorp.com,Demand Planner,Supply Chain
MF034,Barbara Schreiber,barbara.schreiber@mfgcorp.com,MRP Controller,Supply Chain
MF035,Christoph Vogel,christoph.vogel@mfgcorp.com,Procurement Specialist,Supply Chain
MF036,Renate Friedrich,renate.friedrich@mfgcorp.com,Supply Chain Analyst,Supply Chain
MF037,Gerd Keller,gerd.keller@mfgcorp.com,Logistics Coordinator,Supply Chain
MF038,Ulrike Koenig,ulrike.koenig@mfgcorp.com,Purchasing Agent,Supply Chain
MF039,Herbert Mueller,herbert.mueller@mfgcorp.com,Vendor Manager,Supply Chain
MF040,Brigitte Haas,brigitte.haas@mfgcorp.com,Supply Chain Planner,Supply Chain
MF041,Manfred Ludwig,manfred.ludwig@mfgcorp.com,Warehouse Manager,Warehouse
MF042,Erika Busch,erika.busch@mfgcorp.com,Warehouse Supervisor,Warehouse
MF043,Lothar Heinrich,lothar.heinrich@mfgcorp.com,Material Handler,Warehouse
MF044,Doris Seidel,doris.seidel@mfgcorp.com,Inventory Analyst,Warehouse
MF045,Norbert Brandt,norbert.brandt@mfgcorp.com,Receiving Clerk,Warehouse
MF046,Hannelore Graf,hannelore.graf@mfgcorp.com,Shipping Coordinator,Warehouse
MF047,Uwe Pohl,uwe.pohl@mfgcorp.com,Forklift Operator,Warehouse
MF048,Elfriede Kuhn,elfriede.kuhn@mfgcorp.com,Cycle Counter,Warehouse
MF049,Dieter Engel,dieter.engel@mfgcorp.com,Material Handler,Warehouse
MF050,Christa Horn,christa.horn@mfgcorp.com,Warehouse Clerk,Warehouse
MF051,Kurt Sauer,kurt.sauer@mfgcorp.com,Manufacturing Engineer,Engineering
MF052,Gudrun Bauer,gudrun.bauer@mfgcorp.com,Process Engineer,Engineering
MF053,Werner Vogt,werner.vogt@mfgcorp.com,Industrial Engineer,Engineering
MF054,Ilse Sommer,ilse.sommer@mfgcorp.com,Tool Engineer,Engineering
MF055,Heinz Winter,heinz.winter@mfgcorp.com,Design Engineer,Engineering
MF056,Gerda Hauser,gerda.hauser@mfgcorp.com,Methods Engineer,Engineering
MF057,Karl Wolff,karl.wolff@mfgcorp.com,Automation Engineer,Engineering
MF058,Hildegard Berger,hildegard.berger@mfgcorp.com,CAD Designer,Engineering
MF059,Erwin Pfeiffer,erwin.pfeiffer@mfgcorp.com,Engineering Manager,Engineering
MF060,Margot Franke,margot.franke@mfgcorp.com,Project Engineer,Engineering
MF061,Hermann Lang,hermann.lang@mfgcorp.com,EHS Manager,EHS
MF062,Gertrude Kraus,gertrude.kraus@mfgcorp.com,EHS Coordinator,EHS
MF063,Armin Baumann,armin.baumann@mfgcorp.com,Safety Inspector,EHS
MF064,Helga Simon,helga.simon@mfgcorp.com,Environmental Specialist,EHS
MF065,Fritz Schuster,fritz.schuster@mfgcorp.com,Occupational Health Technician,EHS
MF066,Edith Lorenz,edith.lorenz@mfgcorp.com,EHS Data Analyst,EHS
MF067,Otto Boehm,otto.boehm@mfgcorp.com,Waste Management Coordinator,EHS
MF068,Lieselotte Dietrich,lieselotte.dietrich@mfgcorp.com,EHS Compliance Specialist,EHS
MF069,Georg Kuehne,georg.kuehne@mfgcorp.com,Fire Safety Officer,EHS
MF070,Irmgard Schubert,irmgard.schubert@mfgcorp.com,EHS Trainer,EHS
MF071,Paul Beckmann,paul.beckmann@mfgcorp.com,HR Manager,HR
MF072,Waltraud Hahn,waltraud.hahn@mfgcorp.com,HR Business Partner,HR
MF073,Siegfried Kruse,siegfried.kruse@mfgcorp.com,Payroll Administrator,HR
MF074,Rosemarie Voigt,rosemarie.voigt@mfgcorp.com,Training Coordinator,HR
MF075,Max Reuter,max.reuter@mfgcorp.com,Recruiter,HR
MF076,Elisabeth Jansen,elisabeth.jansen@mfgcorp.com,HR Administrator,HR
MF077,Alfred Lindner,alfred.lindner@mfgcorp.com,Benefits Administrator,HR
MF078,Anneliese Winkler,anneliese.winkler@mfgcorp.com,Time and Attendance Clerk,HR
MF079,Gerhard Steiner,gerhard.steiner@mfgcorp.com,Labor Relations Specialist,HR
MF080,Ruth Albrecht,ruth.albrecht@mfgcorp.com,HR Analyst,HR
MF081,Walter Ritter,walter.ritter@mfgcorp.com,Finance Manager,Finance
MF082,Margarete Arnold,margarete.arnold@mfgcorp.com,Cost Accountant,Finance
MF083,Friedrich Herrmann,friedrich.herrmann@mfgcorp.com,AP Specialist,Finance
MF084,Anni Kock,anni.kock@mfgcorp.com,AR Specialist,Finance
MF085,Reinhard Stark,reinhard.stark@mfgcorp.com,Financial Analyst,Finance
MF086,Katharina Grimm,katharina.grimm@mfgcorp.com,GL Accountant,Finance
MF087,Erich Lenz,erich.lenz@mfgcorp.com,Controller,Finance
MF088,Hilde Weiss,hilde.weiss@mfgcorp.com,Budget Analyst,Finance
MF089,Rainer Hoppe,rainer.hoppe@mfgcorp.com,Tax Accountant,Finance
MF090,Ingeborg Kraft,ingeborg.kraft@mfgcorp.com,Finance Clerk,Finance
MF091,Detlef Moser,detlef.moser@mfgcorp.com,IT Manager,IT
MF092,Renata Guenther,renata.guenther@mfgcorp.com,SAP Basis Administrator,IT
MF093,Bernhard Krug,bernhard.krug@mfgcorp.com,Network Administrator,IT
MF094,Evelyn Fiedler,evelyn.fiedler@mfgcorp.com,Help Desk Analyst,IT
MF095,Horst Wendt,horst.wendt@mfgcorp.com,Application Support Analyst,IT
MF096,Hannelore Grosse,hannelore.grosse@mfgcorp.com,IT Security Analyst,IT
MF097,Konrad Pfeffer,konrad.pfeffer@mfgcorp.com,SAP Developer,IT
MF098,Anita Kunze,anita.kunze@mfgcorp.com,Data Analyst,IT
MF099,Wilfried Stein,wilfried.stein@mfgcorp.com,Plant Controller,Finance
MF100,Gisela Bergmann,gisela.bergmann@mfgcorp.com,Production Controller,Production`;

const newUserLines = newUsers
  .map(u => `${u.id},${u.displayName},${u.email},${u.title},${u.dept}`)
  .join("\n");

const usersCsv = `source_user_id,display_name,email,job_title,department\n${existingUserRows}\n${newUserLines}\n`;
writeFileSync(join(__dir, "users.csv"), usersCsv, "utf-8");
console.log(`✅ users.csv: ${1000} users (MF001–MF1000, existing 100 preserved)`);

// ─────────────────────────────────────────────────────────────────
// Write user-source-role-assignments.csv
// ─────────────────────────────────────────────────────────────────

const existingAssignmentRows = `MF001,ZPP_SUPERVISOR
MF001,ZQM_INSPECTOR
MF002,ZPP_PLANNER
MF003,ZPP_SUPERVISOR
MF003,ZPP_PLANNER
MF004,ZPP_OPERATOR
MF005,ZPP_PLANNER
MF006,ZPP_PLANNER
MF006,ZQM_MANAGER
MF007,ZPP_SUPERVISOR
MF008,ZPP_SUPERVISOR
MF009,ZPP_OPERATOR
MF010,ZPP_SUPERVISOR
MF010,ZPP_OPERATOR
MF011,ZQM_MANAGER
MF011,ZQM_AUDITOR
MF012,ZQM_INSPECTOR
MF013,ZQM_INSPECTOR
MF013,ZQM_MANAGER
MF014,ZQM_INSPECTOR
MF015,ZQM_INSPECTOR
MF015,ZMM_HANDLER
MF016,ZQM_INSPECTOR
MF017,ZQM_AUDITOR
MF018,ZQM_INSPECTOR
MF019,ZQM_INSPECTOR
MF020,ZQM_INSPECTOR
MF021,ZPM_PLANNER
MF021,ZPM_ENGINEER
MF022,ZPM_PLANNER
MF023,ZPM_TECHNICIAN
MF024,ZPM_ENGINEER
MF025,ZPM_TECHNICIAN
MF026,ZPM_PLANNER
MF026,ZPM_TECHNICIAN
MF027,ZPM_TECHNICIAN
MF028,ZPM_PLANNER
MF028,ZIT_BASIS
MF029,ZPM_TECHNICIAN
MF029,ZQM_INSPECTOR
MF030,ZPM_PLANNER
MF030,ZPM_TECHNICIAN
MF031,ZMM_BUYER
MF031,ZPP_PLANNER
MF032,ZMM_BUYER
MF032,ZPP_PLANNER
MF033,ZPP_PLANNER
MF034,ZPP_PLANNER
MF034,ZMM_BUYER
MF035,ZMM_BUYER
MF036,ZMM_BUYER
MF037,ZSD_SHIPPING
MF037,ZMM_HANDLER
MF038,ZMM_BUYER
MF039,ZMM_BUYER
MF039,ZFI_AP
MF040,ZMM_BUYER
MF040,ZPP_PLANNER
MF041,ZMM_WAREHOUSE
MF041,ZMM_INVENTORY
MF042,ZMM_WAREHOUSE
MF043,ZMM_HANDLER
MF044,ZMM_INVENTORY
MF044,ZMM_HANDLER
MF045,ZMM_HANDLER
MF045,ZMM_WAREHOUSE
MF046,ZSD_SHIPPING
MF046,ZMM_HANDLER
MF047,ZMM_HANDLER
MF048,ZMM_INVENTORY
MF049,ZMM_HANDLER
MF050,ZMM_HANDLER
MF051,ZPP_PLANNER
MF051,ZQM_MANAGER
MF052,ZPP_PLANNER
MF053,ZPP_PLANNER
MF054,ZPP_PLANNER
MF055,ZPP_PLANNER
MF056,ZPP_PLANNER
MF057,ZPP_PLANNER
MF057,ZIT_BASIS
MF058,ZPP_PLANNER
MF059,ZPP_PLANNER
MF059,ZPP_SUPERVISOR
MF060,ZPP_PLANNER
MF061,ZEHS_COORD
MF061,ZQM_MANAGER
MF062,ZEHS_COORD
MF063,ZEHS_COORD
MF064,ZEHS_COORD
MF065,ZEHS_COORD
MF066,ZEHS_COORD
MF067,ZEHS_COORD
MF068,ZEHS_COORD
MF068,ZQM_AUDITOR
MF069,ZEHS_COORD
MF070,ZEHS_COORD
MF070,ZHR_ADMIN
MF071,ZHR_ADMIN
MF072,ZHR_ADMIN
MF073,ZHR_ADMIN
MF073,ZFI_AP
MF074,ZHR_ADMIN
MF075,ZHR_ADMIN
MF076,ZHR_ADMIN
MF077,ZHR_ADMIN
MF078,ZHR_ADMIN
MF079,ZHR_ADMIN
MF080,ZHR_ADMIN
MF081,ZFI_GL
MF081,ZFI_COST
MF082,ZFI_COST
MF083,ZFI_AP
MF084,ZFI_GL
MF085,ZFI_GL
MF085,ZFI_COST
MF086,ZFI_GL
MF087,ZFI_COST
MF087,ZFI_GL
MF088,ZFI_COST
MF089,ZFI_GL
MF090,ZFI_AP
MF091,ZIT_BASIS
MF092,ZIT_BASIS
MF093,ZIT_BASIS
MF094,ZIT_BASIS
MF095,ZIT_BASIS
MF096,ZIT_BASIS
MF097,ZIT_BASIS
MF098,ZIT_BASIS
MF099,ZFI_COST
MF099,ZPP_SUPERVISOR
MF100,ZPP_SUPERVISOR
MF100,ZFI_COST`;

const newAssignmentLines = newAssignments
  .map(a => `${a.userId},${a.roleId}`)
  .join("\n");

const assignmentsCsv = `user_id,role_id\n${existingAssignmentRows}\n${newAssignmentLines}\n`;
writeFileSync(join(__dir, "user-source-role-assignments.csv"), assignmentsCsv, "utf-8");
console.log(`✅ user-source-role-assignments.csv: ${134 + newAssignments.length} assignment rows`);

// ─────────────────────────────────────────────────────────────────
// Write user-target-role-assignments.csv (existing 109 rows preserved + new)
// ─────────────────────────────────────────────────────────────────

const existingTargetRows = `MF001,S4_PP_SUPERVISOR
MF001,S4_QM_INSPECTOR
MF002,S4_PP_PLANNER
MF003,S4_PP_SUPERVISOR
MF003,S4_PP_PLANNER
MF004,S4_MES_OPERATOR
MF005,S4_PP_PLANNER
MF006,S4_PP_PLANNER
MF006,S4_QM_MANAGER
MF007,S4_PP_SUPERVISOR
MF008,S4_PP_SUPERVISOR
MF009,S4_MES_OPERATOR
MF010,S4_PP_SUPERVISOR
MF010,S4_MES_OPERATOR
MF011,S4_QM_MANAGER
MF011,S4_QM_AUDITOR
MF012,S4_QM_INSPECTOR
MF013,S4_QM_INSPECTOR
MF013,S4_QM_MANAGER
MF014,S4_QM_INSPECTOR
MF015,S4_QM_INSPECTOR
MF015,S4_MM_HANDLER
MF016,S4_QM_INSPECTOR
MF017,S4_QM_AUDITOR
MF018,S4_QM_INSPECTOR
MF019,S4_QM_INSPECTOR
MF020,S4_QM_INSPECTOR
MF021,S4_PM_PLANNER
MF021,S4_PM_ENGINEER
MF022,S4_PM_PLANNER
MF023,S4_PM_TECHNICIAN
MF024,S4_PM_ENGINEER
MF025,S4_PM_TECHNICIAN
MF026,S4_PM_PLANNER
MF026,S4_PM_TECHNICIAN
MF027,S4_PM_TECHNICIAN
MF028,S4_PM_PLANNER
MF029,S4_PM_TECHNICIAN
MF029,S4_QM_INSPECTOR
MF030,S4_PM_PLANNER
MF030,S4_PM_TECHNICIAN
MF031,S4_MM_PURCHASER
MF032,S4_MM_PURCHASER
MF032,S4_PP_PLANNER
MF033,S4_PP_PLANNER
MF034,S4_PP_PLANNER
MF034,S4_MM_PURCHASER
MF035,S4_MM_PURCHASER
MF036,S4_MM_PURCHASER
MF037,S4_SD_SHIPPING
MF037,S4_MM_HANDLER
MF038,S4_MM_PURCHASER
MF039,S4_MM_PURCHASER
MF039,S4_FI_AP
MF040,S4_MM_PURCHASER
MF041,S4_MM_WAREHOUSE
MF041,S4_MM_INVENTORY
MF042,S4_MM_WAREHOUSE
MF043,S4_MM_HANDLER
MF044,S4_MM_INVENTORY
MF044,S4_MM_HANDLER
MF045,S4_MM_HANDLER
MF046,S4_SD_SHIPPING
MF046,S4_MM_HANDLER
MF047,S4_MM_HANDLER
MF048,S4_MM_INVENTORY
MF049,S4_MM_HANDLER
MF050,S4_MM_HANDLER
MF051,S4_PP_PLANNER
MF051,S4_QM_MANAGER
MF052,S4_PP_PLANNER
MF053,S4_PP_PLANNER
MF054,S4_PP_PLANNER
MF055,S4_PP_PLANNER
MF056,S4_PP_PLANNER
MF057,S4_PP_PLANNER
MF058,S4_PP_PLANNER
MF059,S4_PP_PLANNER
MF059,S4_PP_SUPERVISOR
MF060,S4_PP_PLANNER
MF061,S4_EHS_SPECIALIST
MF061,S4_QM_MANAGER
MF062,S4_EHS_SPECIALIST
MF063,S4_EHS_SPECIALIST
MF064,S4_EHS_SPECIALIST
MF065,S4_EHS_SPECIALIST
MF066,S4_EHS_SPECIALIST
MF067,S4_EHS_SPECIALIST
MF068,S4_EHS_SPECIALIST
MF068,S4_QM_AUDITOR
MF069,S4_EHS_SPECIALIST
MF070,S4_EHS_SPECIALIST
MF081,S4_FI_GL
MF081,S4_FI_COST
MF082,S4_FI_COST
MF083,S4_FI_AP
MF084,S4_FI_GL
MF085,S4_FI_GL
MF085,S4_FI_COST
MF086,S4_FI_GL
MF087,S4_FI_COST
MF087,S4_FI_GL
MF088,S4_FI_COST
MF089,S4_FI_GL
MF090,S4_FI_AP
MF099,S4_FI_COST
MF099,S4_PP_SUPERVISOR
MF100,S4_PP_SUPERVISOR
MF100,S4_FI_COST`;

const newTargetLines = newTargetAssignments
  .map(a => `${a.userId},${a.roleId}`)
  .join("\n");

const targetCsv = `user_id,role_id\n${existingTargetRows}\n${newTargetLines}\n`;
writeFileSync(join(__dir, "user-target-role-assignments.csv"), targetCsv, "utf-8");
console.log(`✅ user-target-role-assignments.csv: ${110 + newTargetAssignments.length} assignment rows`);

// Stats summary
const deptCounts = {};
for (const u of newUsers) deptCounts[u.dept] = (deptCounts[u.dept] || 0) + 1;
console.log("\nNew users by department:");
for (const [dept, count] of Object.entries(deptCounts)) {
  console.log(`  ${dept.padEnd(14)} ${count}`);
}
console.log(`\n  TOTAL new     ${newUsers.length}`);
console.log(`  TOTAL all     ${100 + newUsers.length} (including original 100)`);
