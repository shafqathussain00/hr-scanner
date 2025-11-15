import React from 'react';
import { CandidateResult } from '../types';
import { ScoreDisplay } from './ScoreDisplay';

interface CandidateCardProps {
  candidate: CandidateResult;
}

const DetailItem: React.FC<{ label: string; value: string | number | string[] }> = ({ label, value }) => {
    let displayValue: React.ReactNode;

    if (Array.isArray(value)) {
        if (value.length === 0) {
            displayValue = <span className="text-gray-500 italic dark:text-gray-400">None listed</span>;
        } else if (label.toLowerCase().includes('assessment')) {
             displayValue = (
                <ul className="list-disc list-inside space-y-1 mt-1">
                    {value.map((item, index) => <li key={index} className="text-brand-subtext dark:text-gray-400">{item}</li>)}
                </ul>
            );
        } else {
            displayValue = (
                 <div className="flex flex-wrap gap-2 mt-1">
                    {value.map((item, index) => <span key={index} className="px-2 py-0.5 text-xs font-medium text-brand-blue-light bg-blue-100 rounded-full dark:bg-blue-900/50 dark:text-blue-300">{item}</span>)}
                </div>
            )
        }
    } else {
        displayValue = <p className="text-brand-subtext dark:text-gray-400">{value}</p>;
    }
    
    return (
        <div>
            <h5 className="text-sm font-semibold text-brand-text dark:text-gray-200">{label}</h5>
            {displayValue}
        </div>
    );
};


export const CandidateCard: React.FC<CandidateCardProps> = ({ candidate }) => {
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 transition-all hover:shadow-md dark:bg-gray-800 dark:border-gray-700 dark:hover:shadow-blue-900/50">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-brand-blue text-white flex items-center justify-center rounded-full font-bold text-xl ring-4 ring-blue-100 dark:ring-blue-900/50">
                {candidate.rank}
            </div>
            <div>
                <h4 className="text-xl font-bold text-brand-text dark:text-white">
                    {candidate.parsed_resume.name}
                </h4>
                <p className="text-sm text-brand-subtext dark:text-gray-400">{candidate.parsed_resume.email || 'No email provided'}</p>
            </div>
        </div>
        <div className="flex items-center space-x-4 self-start sm:self-center">
          <ScoreDisplay score={candidate.scores.overall_match_score} label="Overall Match" size="large" />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
        <ScoreDisplay score={candidate.scores.semantic_relevance_score} label="Semantic Fit" />
        <ScoreDisplay score={candidate.scores.skill_match_score} label="Skill Match" />
        <ScoreDisplay score={candidate.scores.experience_match_score} label="Experience Match" />
        <ScoreDisplay score={candidate.scores.education_match_score} label="Education Match" />
      </div>

      <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 space-y-4">
        <DetailItem label="Reasoning for Rank" value={candidate.reasoning} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DetailItem label="Strengths" value={candidate.strengths} />
            <DetailItem label="Weaknesses" value={candidate.weaknesses} />
        </div>
        <DetailItem label="Missing Skills" value={candidate.missing_skills} />
        <DetailItem label="Fit Assessment" value={candidate.fit_assessment} />
      </div>
    </div>
  );
};