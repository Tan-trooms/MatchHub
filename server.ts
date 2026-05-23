import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Match Score weights
const SKILLS_WEIGHT = 0.6;
const TRAITS_WEIGHT = 0.4;

// Simulated Databases to support our PostgreSQL relational models
interface Applicant {
  id: string;
  name: string;
  contact: string;
  yearLevel: string;
  skills: string[];
  personalityTraits: string[];
  availability: string;
}

interface Committee {
  id: string;
  name: string;
  requiredSkills: string[];
  preferredTraits: string[];
  maxCapacity: number;
}

interface ApplicationSubmission {
  id: string;
  applicantId: string;
  timestamp: string;
  systemRecommendedCommittee1: string; // Committee Name
  systemRecommendedJustification1: string;
  systemRecommendedCommittee2: string; // Committee Name
  systemRecommendedJustification2: string;
  finalAssignedCommittee: string | null; // Committee Name
  status: 'Pending' | 'Approved' | 'Rejected';
}

interface InterviewQuestion {
  id: string;
  applicantId: string;
  question: string;
  answer: string;
  createdAt: string;
}

// Global In-Memory state mirroring PostgreSQL table data
let applicants: Applicant[] = [
  {
    id: "app-1",
    name: "Tristan Gabriel",
    contact: "tristan.gab18@gmail.com",
    yearLevel: "3rd Year",
    skills: ["React", "Web Development", "Databases", "UI Design"],
    personalityTraits: ["Problem solver", "Curious", "Visual-oriented", "Self-driven"],
    availability: "Mon/Wed/Fri Afternoon, Weekends"
  },
  {
    id: "app-2",
    name: "Sophia Chen",
    contact: "sophia.chen@example.com",
    yearLevel: "2nd Year",
    skills: ["Graphic Design", "Copywriting", "Figma", "Photoshop"],
    personalityTraits: ["Creative", "Empathetic", "Detail-oriented", "Outgoing"],
    availability: "Tues/Thurs, Weekends"
  },
  {
    id: "app-3",
    name: "Marcus Vance",
    contact: "marcus.v@example.com",
    yearLevel: "4th Year",
    skills: ["Excel", "Budgeting", "Project Management", "Negotiation"],
    personalityTraits: ["Analytical", "Organized", "Methodical", "Calm under pressure"],
    availability: "Weekdays Evening"
  },
  {
    id: "app-4",
    name: "Alyssa Ramirez",
    contact: "alyssa.r@example.com",
    yearLevel: "1st Year",
    skills: ["Social Media", "Public Speaking", "Copywriting", "Event Coordinating"],
    personalityTraits: ["Energetic", "Resourceful", "Outgoing", "Empathetic"],
    availability: "Mon/Tues/Wed Morning"
  }
];

let committees: Committee[] = [
  {
    id: "comm-1",
    name: "Technology & Devs",
    requiredSkills: ["Web Development", "Coding", "React", "Git", "Databases"],
    preferredTraits: ["Problem solver", "Curious", "Methodical", "Persistent"],
    maxCapacity: 6
  },
  {
    id: "comm-2",
    name: "Marketing & Creatives",
    requiredSkills: ["Graphic Design", "Copywriting", "Social Media", "Figma"],
    preferredTraits: ["Creative", "Energetic", "Empathetic", "Visual-oriented"],
    maxCapacity: 8
  },
  {
    id: "comm-3",
    name: "Finance & Sponsorships",
    requiredSkills: ["Budgeting", "Excel", "Negotiation", "Fundraising"],
    preferredTraits: ["Analytical", "Detail-oriented", "Organized", "Responsible"],
    maxCapacity: 5
  },
  {
    id: "comm-4",
    name: "Logistics & Operations",
    requiredSkills: ["Event Coordinating", "Project Management", "Vendor Relations", "Operations"],
    preferredTraits: ["Decisive", "Calm under pressure", "Resourceful", "Outgoing"],
    maxCapacity: 10
  }
];

let submissions: ApplicationSubmission[] = [
  {
    id: "sub-1",
    applicantId: "app-3",
    timestamp: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    systemRecommendedCommittee1: "Finance & Sponsorships",
    systemRecommendedJustification1: "Marcus has outstanding experience in budgeting and quantitative negotiation. His analytical and organized nature suits details in sponsorships.",
    systemRecommendedCommittee2: "Logistics & Operations",
    systemRecommendedJustification2: "Our matching vector shows Marcus holds sturdy project management skills matching logistics needs. His ability to stay calm under pressure acts as an operational asset.",
    finalAssignedCommittee: "Finance & Sponsorships",
    status: "Approved"
  }
];

let interviewQuestions: InterviewQuestion[] = [];

function generateInterviewAnswer(applicant: Applicant, question: string): string {
  const cleanQuestion = question.trim();
  const baseSkills = applicant.skills.slice(0, 3).join(", ") || "a broad skillset";
  const baseTraits = applicant.personalityTraits.slice(0, 3).join(", ") || "a strong work ethic";
  const skillSentence = `I would use my experience with ${baseSkills} to address this question directly.`;
  const traitSentence = `My ${baseTraits} strengths help me stay calm, collaborative, and solutions-oriented while answering.`;

  if (/experience|project|challenge|problem/i.test(cleanQuestion)) {
    return `When asked about past experience, I highlight how I have applied ${baseSkills} in real situations. ${traitSentence}`;
  }
  if (/team|collaborate|communication|support/i.test(cleanQuestion)) {
    return `I enjoy working with teams and leverage my ${baseTraits} when collaborating across tasks. ${skillSentence}`;
  }
  if (/why|motivat|interested|passion/i.test(cleanQuestion)) {
    return `I am motivated by opportunities that let me apply ${baseSkills} while growing in a supportive environment. ${traitSentence}`;
  }

  return `${skillSentence} ${traitSentence}`;
}

function getInterviewSimulationForApplicant(applicantId: string): InterviewQuestion[] {
  return interviewQuestions.filter((entry) => entry.applicantId === applicantId);
}

// Lazy-initialized Gemini Client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("GEMINI_API_KEY environment variable is not defined. Active fallback matching logic deployed.");
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiClient;
}

// Match Score calculation following vector intersection algorithm
function computeMatchScore(applicant: Applicant, committee: Committee): {
  score: number;
  matchedSkills: string[];
  matchedTraits: string[];
} {
  const appSkills = new Set(applicant.skills.map(s => s.toLowerCase().trim()));
  const commSkills = new Set(committee.requiredSkills.map(s => s.toLowerCase().trim()));
  
  const appTraits = new Set(applicant.personalityTraits.map(t => t.toLowerCase().trim()));
  const commTraits = new Set(committee.preferredTraits.map(t => t.toLowerCase().trim()));

  const matchedSkills = applicant.skills.filter(s => commSkills.has(s.toLowerCase().trim()));
  const matchedTraits = applicant.personalityTraits.filter(t => commTraits.has(t.toLowerCase().trim()));

  const skillsScore = committee.requiredSkills.length > 0 
    ? (matchedSkills.length / committee.requiredSkills.length) 
    : 0.0;

  const traitsScore = committee.preferredTraits.length > 0
    ? (matchedTraits.length / committee.preferredTraits.length)
    : 0.0;

  const rawScore = (skillsScore * SKILLS_WEIGHT) + (traitsScore * TRAITS_WEIGHT);
  const percentage = Math.round(rawScore * 1000) / 10; // e.g. 75.5%

  return {
    score: percentage,
    matchedSkills,
    matchedTraits
  };
}

// ---------------------- API ROUTES ----------------------

// Health Check
app.get("/api/v1/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// GET Applicants
app.get("/api/v1/applicants", (req, res) => {
  res.json(applicants);
});

// POST Applicant
app.post("/api/v1/applicants", (req, res) => {
  const { name, contact, yearLevel, skills, personalityTraits, availability } = req.body;
  if (!name || !contact) {
    return res.status(400).json({ error: "Name and contact are required fields." });
  }
  const newApp: Applicant = {
    id: `app-${Date.now()}`,
    name,
    contact,
    yearLevel: yearLevel || "1st Year",
    skills: Array.isArray(skills) ? skills : [],
    personalityTraits: Array.isArray(personalityTraits) ? personalityTraits : [],
    availability: availability || "Flexible"
  };
  applicants.push(newApp);
  res.status(201).json(newApp);
});

// DELETE Applicant
app.delete("/api/v1/applicants/:id", (req, res) => {
  const { id } = req.params;
  applicants = applicants.filter(a => a.id !== id);
  submissions = submissions.filter(s => s.applicantId !== id);
  res.json({ success: true });
});

// GET Committees
app.get("/api/v1/committees", (req, res) => {
  res.json(committees);
});

// POST Committee
app.post("/api/v1/committees", (req, res) => {
  const { name, requiredSkills, preferredTraits, maxCapacity } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Committee name is required." });
  }
  const newComm: Committee = {
    id: `comm-${Date.now()}`,
    name,
    requiredSkills: Array.isArray(requiredSkills) ? requiredSkills : [],
    preferredTraits: Array.isArray(preferredTraits) ? preferredTraits : [],
    maxCapacity: Number(maxCapacity) || 10
  };
  committees.push(newComm);
  res.status(201).json(newComm);
});

// DELETE Committee
app.delete("/api/v1/committees/:id", (req, res) => {
  const { id } = req.params;
  committees = committees.filter(c => c.id !== id);
  res.json({ success: true });
});

// GET Submissions
app.get("/api/v1/submissions", (req, res) => {
  res.json(submissions);
});

// UPDATE/ASSIGN Final Committee Submission
app.post("/api/v1/submissions/assign", (req, res) => {
  const { id, finalAssignedCommittee, status } = req.body;
  const sub = submissions.find(s => s.id === id);
  if (!sub) {
    return res.status(404).json({ error: "Submission log not found" });
  }
  if (finalAssignedCommittee !== undefined) sub.finalAssignedCommittee = finalAssignedCommittee;
  if (status !== undefined) sub.status = status;
  res.json(sub);
});

// Interview Simulation: questions / answers for a given applicant
app.get("/api/v1/applicants/:applicantId/interview-simulation", (req, res) => {
  const { applicantId } = req.params;
  const applicant = applicants.find(a => a.id === applicantId);
  if (!applicant) {
    return res.status(404).json({ error: `Applicant ${applicantId} not found` });
  }
  res.json(getInterviewSimulationForApplicant(applicantId));
});

app.post("/api/v1/applicants/:applicantId/interview-simulation/questions", (req, res) => {
  const { applicantId } = req.params;
  const { question } = req.body;
  const applicant = applicants.find(a => a.id === applicantId);
  if (!applicant) {
    return res.status(404).json({ error: `Applicant ${applicantId} not found` });
  }
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Question text is required." });
  }
  const newQuestion: InterviewQuestion = {
    id: `q-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    applicantId,
    question: question.trim(),
    answer: generateInterviewAnswer(applicant, question.trim()),
    createdAt: new Date().toISOString()
  };
  interviewQuestions.push(newQuestion);
  res.status(201).json(newQuestion);
});

app.delete("/api/v1/applicants/:applicantId/interview-simulation/questions/:questionId", (req, res) => {
  const { applicantId, questionId } = req.params;
  const applicant = applicants.find(a => a.id === applicantId);
  if (!applicant) {
    return res.status(404).json({ error: `Applicant ${applicantId} not found` });
  }
  const beforeCount = interviewQuestions.length;
  interviewQuestions = interviewQuestions.filter((entry) => !(entry.applicantId === applicantId && entry.id === questionId));
  if (interviewQuestions.length === beforeCount) {
    return res.status(404).json({ error: "Interview question not found." });
  }
  res.json({ success: true });
});

// USER REQUEST Core requirement: API endpoint structure for Recommendations returning JSON
app.get("/api/v1/recommendations/:applicantId", async (req, res) => {
  const { applicantId } = req.params;
  const applicant = applicants.find(a => a.id === applicantId);
  
  if (!applicant) {
    return res.status(404).json({ error: `Applicant with ID ${applicantId} not found` });
  }

  // Calculate scores for all committees
  const scoredCommittees = committees.map(comm => {
    const { score, matchedSkills, matchedTraits } = computeMatchScore(applicant, comm);
    return {
      committee: comm,
      score,
      matchedSkills,
      matchedTraits
    };
  });

  // Sort descending by match score
  scoredCommittees.sort((a, b) => b.score - a.score);

  // Take top 2 recommended
  const top2 = scoredCommittees.slice(0, 2);

  if (top2.length === 0) {
    return res.json({
      applicantId,
      applicantName: applicant.name,
      recommendations: []
    });
  }

  const recommendations = [];
  const ai = getGeminiClient();

  for (let i = 0; i < top2.length; i++) {
    const item = top2[i];
    const commName = item.committee.name;
    const score = item.score;
    let justification = "";

    if (ai) {
      try {
        const prompt = `You are a professional matching and recruitment analytics model for a prestigious student organization. 
Justify why the candidate named "${applicant.name}" is a great match for the "${commName}" committee.
Candidate Technical/Execution Skills: [${applicant.skills.join(", ")}].
Candidate Traits: [${applicant.personalityTraits.join(", ")}].
Committee Requirements: Skills: [${item.committee.requiredSkills.join(", ")}], Preferred Traits: [${item.committee.preferredTraits.join(", ")}].

Provide EXACTLY TWO SENTENCES of justification. No introductory preambles or concluding wraps. Keep it encouraging, professional, and highlight the vector synergy.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            temperature: 0.7,
          }
        });
        
        justification = response.text ? response.text.trim() : "";
      } catch (err: any) {
        console.error("Gemini call error, falling back locally:", err.message);
      }
    }

    // High quality intelligent local template fallback
    if (!justification) {
      const skillsMatchText = item.matchedSkills.length > 0 
        ? `Their proven skillset in ${item.matchedSkills.slice(0, 2).join(" & ")} correlates perfectly with the operations of ${commName}.`
        : `Even without direct tool matches, their profile reveals deep adaptability to cover core ${commName} responsibilities.`;

      const traitsMatchText = item.matchedTraits.length > 0
        ? `Additionally, their preferred traits of ${item.matchedTraits.slice(0, 2).join(" & ")} harmonize with the team culture.`
        : `Moreover, their general collaborative traits of ${applicant.personalityTraits.slice(0, 2).join(" and ")} align with the organizational culture of our group.`;

      justification = `${skillsMatchText} ${traitsMatchText}`;
    }

    recommendations.push({
      committeeId: item.committee.id,
      committeeName: commName,
      matchScore: score,
      matchedSkills: item.matchedSkills,
      matchedTraits: item.matchedTraits,
      justification
    });
  }

  // Create or update a submission log in simulated Application_Submissions database table
  const existingSubIndex = submissions.findIndex(s => s.applicantId === applicantId);
  const submissionData: ApplicationSubmission = {
    id: existingSubIndex !== -1 ? submissions[existingSubIndex].id : `sub-${Date.now()}`,
    applicantId,
    timestamp: new Date().toISOString(),
    systemRecommendedCommittee1: recommendations[0]?.committeeName || "None",
    systemRecommendedJustification1: recommendations[0]?.justification || "",
    systemRecommendedCommittee2: recommendations[1]?.committeeName || "None",
    systemRecommendedJustification2: recommendations[1]?.justification || "",
    finalAssignedCommittee: existingSubIndex !== -1 ? submissions[existingSubIndex].finalAssignedCommittee : null,
    status: existingSubIndex !== -1 ? submissions[existingSubIndex].status : "Pending"
  };

  if (existingSubIndex !== -1) {
    submissions[existingSubIndex] = submissionData;
  } else {
    submissions.push(submissionData);
  }

  res.json({
    applicantId,
    applicantName: applicant.name,
    recommendations,
    timestamp: submissionData.timestamp,
    submissionRecordId: submissionData.id
  });
});

// Setup Vite & Static Assets routing
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Staging dev server with Vite integration...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Staging production build serving...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Port ${PORT} running. Access available on localhost:${PORT}`);
  });
}

startServer();
