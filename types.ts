
export interface ParsedResume {
  name: string;
  email: string;
  phone: string;
  skills: string[];
  experience_years: number;
  education_level: string;
  work_history_summary: string;
  projects: string[];
  certifications: string[];
  short_summary: string;
}

export interface ParsedJobDescription {
  role: string;
  required_skills: string[];
  preferred_skills: string[];
  minimum_experience: number;
  education_required: string;
  job_summary:string;
}

// Types for the final, processed data used by the UI
export interface CandidateScores {
  skill_match_score: number;
  experience_match_score: number;
  education_match_score: number;
  semantic_relevance_score: number;
  overall_match_score: number;
}

export interface CandidateResult {
  rank: number;
  parsed_resume: ParsedResume;
  scores: CandidateScores;
  reasoning: string;
  strengths: string[];
  weaknesses: string[];
  missing_skills: string[];
  fit_assessment: string[];
}

export interface AnalysisResult {
  parsed_job_description: ParsedJobDescription;
  ranked_candidates: CandidateResult[];
  bias_analysis: BiasAnalysis;
  final_recommendation: FinalRecommendation;
}


// Types for the raw, unprocessed data from the Gemini API
export interface UnrankedCandidateScores {
  skill_match_score: number;
  experience_match_score: number;
  education_match_score: number;
  semantic_relevance_score: number;
}

export interface UnrankedCandidateResult {
  parsed_resume: ParsedResume;
  scores: UnrankedCandidateScores;
  reasoning: string;
  strengths: string[];
  weaknesses: string[];
  missing_skills: string[];
  fit_assessment: string[];
}

export interface RawAnalysisResult {
  parsed_job_description: ParsedJobDescription;
  candidate_analysis: UnrankedCandidateResult[];
  bias_analysis: BiasAnalysis;
  final_recommendation: FinalRecommendation;
}

export interface BiasFlag {
  flag: string;
  category: string;
  severity: 'Low' | 'Medium' | 'High' | string;
}

export interface BiasAnalysis {
  bias_flags: BiasFlag[];
}

export interface FinalRecommendation {
  top_candidate: string;
  reasoning: string;
}