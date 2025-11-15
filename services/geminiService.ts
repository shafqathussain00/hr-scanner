
import { GoogleGenAI, Type } from "@google/genai";
import { RawAnalysisResult, ParsedJobDescription, UnrankedCandidateResult, BiasAnalysis, FinalRecommendation } from '../types';

export interface FilePart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

// --- Schemas ---

const jdSchema = {
    type: Type.OBJECT,
    properties: {
        role: { type: Type.STRING },
        required_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
        preferred_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
        minimum_experience: { type: Type.NUMBER },
        education_required: { type: Type.STRING },
        job_summary: { type: Type.STRING },
    },
};

const singleCandidateSchema = {
    type: Type.OBJECT,
    properties: {
        parsed_resume: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING },
                email: { type: Type.STRING },
                phone: { type: Type.STRING },
                skills: { type: Type.ARRAY, items: { type: Type.STRING } },
                experience_years: { type: Type.NUMBER },
                education_level: { type: Type.STRING },
                work_history_summary: { type: Type.STRING },
                projects: { type: Type.ARRAY, items: { type: Type.STRING } },
                certifications: { type: Type.ARRAY, items: { type: Type.STRING } },
                short_summary: { type: Type.STRING },
            },
        },
        scores: {
            type: Type.OBJECT,
            properties: {
                skill_match_score: { type: Type.NUMBER },
                experience_match_score: { type: Type.NUMBER },
                education_match_score: { type: Type.NUMBER },
                semantic_relevance_score: { type: Type.NUMBER },
            },
        },
        reasoning: { type: Type.STRING },
        strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
        weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
        missing_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
        fit_assessment: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
};

const finalSummarySchema = {
    type: Type.OBJECT,
    properties: {
        bias_analysis: {
            type: Type.OBJECT,
            properties: {
                bias_flags: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            flag: { type: Type.STRING, description: "The specific bias detected, e.g., 'Use of gendered language like salesman'." },
                            category: { type: Type.STRING, description: "The category of the bias, e.g., 'Gender', 'Age-Related Phrasing'." },
                            severity: { type: Type.STRING, enum: ['Low', 'Medium', 'High'], description: "The potential severity of the bias." },
                        }
                    }
                },
            },
        },
        final_recommendation: {
            type: Type.OBJECT,
            properties: {
                top_candidate: { type: Type.STRING },
                reasoning: { type: Type.STRING },
            },
        },
    }
};

// --- Helper for API calls ---
const callGemini = async (prompt: string | any[], schema: any, modelName: string = "gemini-2.5-pro") => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const contents = Array.isArray(prompt) ? { parts: prompt } : { parts: [{ text: prompt }] };

    const response = await ai.models.generateContent({
        model: modelName,
        contents: contents,
        config: {
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: 0.1,
        },
    });

    if (!response || !response.text) {
        console.error("The model returned an empty or invalid response object:", response);
        throw new Error("The model returned an empty response. Please try again.");
    }

    const jsonText = response.text.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    if (!jsonText) {
        console.error("The model returned an empty text response.");
        throw new Error("The model returned an empty response. Please try again.");
    }
    
    try {
        return JSON.parse(jsonText);
    } catch (e) {
        console.error("Failed to parse JSON response:", jsonText);
        console.error("Original parsing error:", e);
        throw new Error("The model returned an invalid JSON format. Check the console for the raw response.");
    }
};


// --- API Service Functions ---

export const analyzeJobDescription = async (jobDescriptionPart: { text: string } | FilePart): Promise<ParsedJobDescription> => {
    const prompt = `
        You are an expert HR assistant. Analyze the following job description and extract the key details into a valid JSON object conforming to the provided schema.
        
        - role: The job title.
        - required_skills: A list of essential skills.
        - preferred_skills: A list of desired but not essential skills.
        - minimum_experience: The minimum years of experience required, as a number.
        - education_required: The required educational background.
        - job_summary: A brief, one-paragraph summary of the role.
        
        CRITICAL: Your output must be only the JSON object, with no other text or markdown.
    `;
    const allParts = [{ text: prompt }, jobDescriptionPart];
    return await callGemini(allParts, { type: Type.OBJECT, properties: jdSchema.properties }) as ParsedJobDescription;
};

export const analyzeSingleResume = async (parsedJd: ParsedJobDescription, resumePart: FilePart): Promise<UnrankedCandidateResult> => {
    const prompt = `
        You are HR-Screener-AI. Your task is to analyze a single candidate's resume against the provided job description data and return a single, valid JSON object that conforms to the provided schema.

        **Job Description Context:**
        ${JSON.stringify(parsedJd, null, 2)}

        **Instructions:**
        Analyze the provided resume file and perform the following steps:
        1.  **Parse Resume**: Extract the candidate's details into the 'parsed_resume' object.
        2.  **Evaluate and Score**: Semantically compare the resume to the job description context and compute the four scores (0-100) for the 'scores' object.
        3.  **Generate Report**: Provide a written analysis including reasoning, strengths, weaknesses, missing skills, and a fit assessment.

        CRITICAL: Your entire output must be a single, valid JSON object. Do not include any other text or markdown formatting.
    `;
    const allParts = [{ text: prompt }, resumePart];
    return await callGemini(allParts, singleCandidateSchema, "gemini-2.5-flash") as UnrankedCandidateResult;
};

export const getFinalSummary = async (candidateAnalyses: UnrankedCandidateResult[]): Promise<{ bias_analysis: BiasAnalysis; final_recommendation: FinalRecommendation }> => {
    const simplifiedAnalyses = candidateAnalyses.map(c => ({
        name: c.parsed_resume.name,
        scores: c.scores,
        summary: c.reasoning,
        strengths: c.strengths,
        weaknesses: c.weaknesses,
    }));

    const prompt = `
        You are an expert HR manager. Based on the following summarized analyses of multiple candidates, please provide a final report in JSON format.

        **Candidate Summaries:**
        ${JSON.stringify(simplifiedAnalyses, null, 2)}

        **Instructions:**
        1.  **Bias Analysis**: Review the summaries and your (the AI's) reasoning. Identify any potential biases (e.g., gender, age, education prestige). Populate the 'bias_flags' array with objects, each containing a 'flag', 'category', and 'severity'. 
        2.  **Final Recommendation**: Based on all the data, name the top candidate and provide a brief justification in the 'final_recommendation' object.

        CRITICAL: If no biases are found, the 'bias_flags' array MUST be an empty array []. Your entire output must be a single, valid JSON object.
    `;
    
    return await callGemini(prompt, finalSummarySchema) as { bias_analysis: BiasAnalysis; final_recommendation: FinalRecommendation };
};