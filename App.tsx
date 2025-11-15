import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AnalysisResult, RawAnalysisResult, CandidateResult, ParsedJobDescription, UnrankedCandidateResult, BiasAnalysis, FinalRecommendation } from './types';
import { analyzeJobDescription, analyzeSingleResume, getFinalSummary, FilePart } from './services/geminiService';
import { generatePdf } from './services/pdfGenerator';
import { CandidateCard } from './components/CandidateCard';
import { LoadingSpinner } from './components/LoadingSpinner';
import { DocumentIcon, SparklesIcon, ExclamationTriangleIcon, LightBulbIcon, UploadIcon, TrashIcon, XCircleIcon, DownloadIcon, FilterIcon, MoonIcon, SunIcon } from './components/icons';
import { exampleJobDescription } from './constants';


const App: React.FC = () => {
  const [jobDescription, setJobDescription] = useState<string>('');
  const [resumeFiles, setResumeFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [progress, setProgress] = useState(0);
  
  // State for resume drag-and-drop
  const [isResumesDragging, setIsResumesDragging] = useState<boolean>(false);
  const resumeFileInputRef = useRef<HTMLInputElement>(null);

  // State for job description input
  const [jdInputMethod, setJdInputMethod] = useState<'text' | 'file'>('text');
  const [jobDescriptionFile, setJobDescriptionFile] = useState<File | null>(null);
  const [isJdDragging, setIsJdDragging] = useState<boolean>(false);
  const jdFileInputRef = useRef<HTMLInputElement>(null);

  // State for filtering
  const [filterScore, setFilterScore] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');

  // State for PDF generation
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  // State for dark mode
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem('hr-screener-dark-mode');
      if (stored !== null) return JSON.parse(stored);
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.toggle('dark', isDarkMode);
    localStorage.setItem('hr-screener-dark-mode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(!isDarkMode);

  const fileToPart = (file: File): Promise<FilePart> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            if (typeof reader.result !== 'string') {
                return reject(new Error('FileReader result is not a string'));
            }
            const base64Data = reader.result.split(',')[1];
            resolve({
                inlineData: {
                    mimeType: file.type,
                    data: base64Data
                }
            });
        };
        reader.onerror = error => reject(error);
    });
  };

  const processAnalysis = (rawResult: RawAnalysisResult): AnalysisResult => {
    if (!rawResult || !Array.isArray(rawResult.candidate_analysis)) {
      console.error("Invalid raw result from API: candidate_analysis is missing or not an array.", rawResult);
      throw new Error("The AI's analysis was incomplete or malformed. It failed to return candidate data.");
    }

    const candidatesWithOverall = rawResult.candidate_analysis.map(candidate => {
        const scores = (candidate.scores || {}) as Partial<typeof candidate.scores>;
        const semantic = Math.max(0, Math.min(100, scores.semantic_relevance_score || 0));
        const skill = Math.max(0, Math.min(100, scores.skill_match_score || 0));
        const experience = Math.max(0, Math.min(100, scores.experience_match_score || 0));
        const education = Math.max(0, Math.min(100, scores.education_match_score || 0));
        
        const overall_match_score = (semantic * 0.45) + (skill * 0.30) + (experience * 0.20) + (education * 0.05);
        
        return {
            ...candidate,
            scores: {
                semantic_relevance_score: semantic,
                skill_match_score: skill,
                experience_match_score: experience,
                education_match_score: education,
                overall_match_score: overall_match_score,
            }
        };
    });

    const sortedCandidates = candidatesWithOverall.sort((a, b) => b.scores.overall_match_score - a.scores.overall_match_score);

    const rankedCandidates: CandidateResult[] = sortedCandidates.map((candidate, index) => ({
        ...candidate,
        rank: index + 1,
    }));
    
    return {
        parsed_job_description: rawResult.parsed_job_description || { role: 'N/A', required_skills: [], preferred_skills: [], minimum_experience: 0, education_required: 'N/A', job_summary: 'N/A' },
        ranked_candidates: rankedCandidates,
        bias_analysis: rawResult.bias_analysis || { bias_flags: [] },
        final_recommendation: rawResult.final_recommendation || { top_candidate: 'N/A', reasoning: 'Final recommendation was not provided.' }
    };
  };

  const handleAnalyze = useCallback(async () => {
    const isJdTextValid = jdInputMethod === 'text' && jobDescription.trim();
    const isJdFileValid = jdInputMethod === 'file' && jobDescriptionFile;

    if ((!isJdTextValid && !isJdFileValid) || resumeFiles.length === 0) {
      setError('Please provide a job description and at least one resume file.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setSearchTerm('');
    setFilterScore(0);

    try {
      // STEP 1: Analyze Job Description
      setLoadingMessage('Analyzing job description...');
      let jobDescriptionPart: { text: string } | FilePart;
      if (isJdFileValid) {
          jobDescriptionPart = await fileToPart(jobDescriptionFile as File);
      } else {
          jobDescriptionPart = { text: jobDescription };
      }
      const parsedJd: ParsedJobDescription = await analyzeJobDescription(jobDescriptionPart);
      setProgress(5); // Small progress after JD is done

      // STEP 2: Analyze Resumes Individually and Concurrently
      const resumeParts = await Promise.all(resumeFiles.map(fileToPart));
      const totalResumes = resumeParts.length;
      let completedResumes = 0;
      
      setLoadingMessage(`Analyzing 1 of ${totalResumes} candidates...`);

      const candidateAnalysesPromises: Promise<UnrankedCandidateResult>[] = resumeParts.map((part) =>
        analyzeSingleResume(parsedJd, part).then((result) => {
            completedResumes++;
            // We'll scale progress from 5% to 95% during this phase
            setProgress(5 + Math.round((completedResumes / totalResumes) * 90));
            setLoadingMessage(`Analyzed ${completedResumes} of ${totalResumes} candidates...`);
            return result;
        })
      );
      
      const candidateAnalyses: UnrankedCandidateResult[] = await Promise.all(candidateAnalysesPromises);
      
      // STEP 3: Get Final Summary
      setLoadingMessage('Generating final report...');
      const finalSummary: { bias_analysis: BiasAnalysis; final_recommendation: FinalRecommendation } = await getFinalSummary(candidateAnalyses);
      setProgress(100);

      // STEP 4: Assemble the full result object
      const rawAnalysisResult: RawAnalysisResult = {
        parsed_job_description: parsedJd,
        candidate_analysis: candidateAnalyses,
        bias_analysis: finalSummary.bias_analysis,
        final_recommendation: finalSummary.final_recommendation,
      };

      const finalResult = processAnalysis(rawAnalysisResult);
      setResult(finalResult);

    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'An unknown error occurred.');
    } finally {
      setLoading(false);
      setLoadingMessage('');
      setProgress(0);
    }
  }, [jobDescription, resumeFiles, jdInputMethod, jobDescriptionFile]);


  const loadExampleData = () => {
    setJobDescription(exampleJobDescription);
    setJobDescriptionFile(null);
    setJdInputMethod('text');
    setResumeFiles([]);
    setError(null);
  };

  const handleDownloadPdf = async () => {
    if (!result) return;

    setIsGeneratingPdf(true);
    setError(null);

    try {
        // Yield to the event loop to allow the UI to update to the "Generating..." state
        await new Promise(resolve => setTimeout(resolve, 50));
        generatePdf(result);
    } catch (err) {
        console.error('Failed to generate PDF:', err);
        setError('Could not generate PDF. Please try again.');
    } finally {
        setIsGeneratingPdf(false);
    }
  };

  // --- Resume File Handlers ---
  const handleResumeFiles = (files: FileList | null) => {
    if (files) {
        const newFiles = Array.from(files).filter(
            file => !resumeFiles.some(existingFile => existingFile.name === file.name && existingFile.size === file.size)
        );
        setResumeFiles(prevFiles => [...prevFiles, ...newFiles]);
    }
  };
  const handleResumeDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsResumesDragging(true); };
  const handleResumeDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsResumesDragging(false); };
  const handleResumeDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsResumesDragging(false);
      handleResumeFiles(e.dataTransfer.files);
  };
  const handleResumeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      handleResumeFiles(e.target.files);
      if(e.target) e.target.value = '';
  };
  const handleRemoveResumeFile = (index: number) => {
      setResumeFiles(prevFiles => prevFiles.filter((_, i) => i !== index));
  };
  const handleClearAllResumes = () => {
      setResumeFiles([]);
  };
  
  // --- Job Description File Handlers ---
  const handleJdFile = (file: File | null) => {
    if (file) setJobDescriptionFile(file);
  };
  const handleJdDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsJdDragging(true); };
  const handleJdDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsJdDragging(false); };
  const handleJdDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsJdDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleJdFile(e.dataTransfer.files[0]);
  };
  const handleJdFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) handleJdFile(e.target.files[0]);
      if(e.target) e.target.value = '';
  };
  const handleRemoveJdFile = () => setJobDescriptionFile(null);
  const handleSwitchJdInput = (method: 'text' | 'file') => {
      setJdInputMethod(method);
      if (method === 'text') setJobDescriptionFile(null);
      else setJobDescription('');
  }

  const filteredCandidates = result?.ranked_candidates.filter(candidate => {
    const scoreMatch = candidate.scores.overall_match_score >= filterScore;
    const searchLower = searchTerm.toLowerCase();
    const searchMatch = !searchTerm ||
        candidate.parsed_resume.name.toLowerCase().includes(searchLower) ||
        (candidate.parsed_resume.skills || []).some(skill => skill.toLowerCase().includes(searchLower));
    return scoreMatch && searchMatch;
  }) || [];

  return (
    <div className="min-h-screen bg-gray-50 text-brand-text dark:bg-gray-900 dark:text-gray-200">
      <header className="bg-white shadow-sm sticky top-0 z-10 dark:bg-gray-800 dark:border-b dark:border-gray-700">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <SparklesIcon className="w-8 h-8 text-brand-blue" />
            <h1 className="text-2xl font-bold text-brand-text dark:text-white">HR Screener AI</h1>
          </div>
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? <SunIcon className="w-6 h-6" /> : <MoonIcon className="w-6 h-6" />}
          </button>
        </div>
      </header>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 dark:bg-gray-800 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
                 <h2 className="text-xl font-semibold flex items-center dark:text-white">
                    <DocumentIcon className="w-6 h-6 mr-2 text-brand-blue-light" />
                    Input Data
                </h2>
                <button
                  onClick={loadExampleData}
                  className="px-3 py-1.5 text-sm font-medium text-brand-blue-light bg-blue-100 rounded-md hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/80 transition-colors flex items-center"
                  >
                  <LightBulbIcon className="w-4 h-4 mr-1.5" />
                  Load Example JD
                </button>
            </div>
           
            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                    <label htmlFor="jobDescription" className="block text-sm font-medium text-brand-subtext dark:text-gray-400">
                        Job Description
                    </label>
                    <div className="flex rounded-md shadow-sm">
                        <button onClick={() => handleSwitchJdInput('text')} className={`px-3 py-1 text-xs font-medium rounded-l-md transition-colors ${jdInputMethod === 'text' ? 'bg-brand-blue text-white z-10 ring-1 ring-brand-blue' : 'bg-white text-gray-700 hover:bg-gray-50 border dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600'}`}>
                            Paste Text
                        </button>
                        <button onClick={() => handleSwitchJdInput('file')} className={`px-3 py-1 text-xs font-medium rounded-r-md transition-colors -ml-px ${jdInputMethod === 'file' ? 'bg-brand-blue text-white z-10 ring-1 ring-brand-blue' : 'bg-white text-gray-700 hover:bg-gray-50 border dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600'}`}>
                            Upload File
                        </button>
                    </div>
                </div>
                {jdInputMethod === 'text' ? (
                     <div>
                        <div className="relative">
                            <textarea
                                id="jobDescription"
                                value={jobDescription}
                                onChange={(e) => setJobDescription(e.target.value)}
                                placeholder="Paste the job description here. The more detail, the better the analysis."
                                className="w-full h-48 p-3 pr-10 bg-gray-50 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-brand-blue-light focus:border-brand-blue-light transition resize-y dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
                                aria-label="Job Description"
                            />
                            {jobDescription.length > 0 && (
                                <button
                                    onClick={() => setJobDescription('')}
                                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                    aria-label="Clear job description text"
                                    title="Clear text"
                                >
                                    <XCircleIcon className="w-5 h-5" />
                                </button>
                            )}
                        </div>
                        <p className="text-right text-xs text-gray-500 dark:text-gray-400 mt-1 pr-1">
                            {jobDescription.trim().split(/\s+/).filter(Boolean).length} words
                        </p>
                    </div>
                ) : (
                    <div>
                        {!jobDescriptionFile ? (
                           <div 
                                onClick={() => jdFileInputRef.current?.click()}
                                onDrop={handleJdDrop} 
                                onDragOver={handleJdDragOver} 
                                onDragLeave={handleJdDragLeave}
                                className={`flex flex-col items-center justify-center p-6 border-2 ${isJdDragging ? 'border-brand-blue' : 'border-gray-300 dark:border-gray-600'} border-dashed rounded-md cursor-pointer hover:border-brand-blue-light transition-colors`}
                            >
                                <div className="space-y-1 text-center">
                                    <UploadIcon className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-500" />
                                    <p className="text-sm text-gray-600 dark:text-gray-400"><span className="font-semibold text-brand-blue-light">Upload a file</span> or drag and drop</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-500">PDF, DOCX, DOC, TXT</p>
                                </div>
                                <input ref={jdFileInputRef} type="file" className="hidden" onChange={handleJdFileChange} accept=".pdf,.doc,.docx,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"/>
                            </div>
                        ) : (
                           <div className="flex items-center justify-between bg-gray-100 p-2 pl-3 rounded-md dark:bg-gray-700">
                                <p className="text-sm text-brand-text dark:text-gray-200 truncate pr-2">{jobDescriptionFile.name}</p>

                                <button onClick={handleRemoveJdFile} className="p-1 text-red-500 hover:text-red-700 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors" aria-label={`Remove ${jobDescriptionFile.name}`}>
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                        )}
                    </div>
                )}
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                    <label className="block text-sm font-medium text-brand-subtext dark:text-gray-400">
                    Candidate Resumes <span className="text-gray-500 text-xs font-normal dark:text-gray-500">({resumeFiles.length} uploaded)</span>
                    </label>
                    {resumeFiles.length > 1 && (
                        <button
                            onClick={handleClearAllResumes}
                            className="px-2 py-1 text-xs font-medium text-red-600 bg-red-100 rounded-md hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors"
                        >
                            Clear All
                        </button>
                    )}
                </div>
                <div 
                    onClick={() => resumeFileInputRef.current?.click()}
                    onDrop={handleResumeDrop} 
                    onDragOver={handleResumeDragOver} 
                    onDragLeave={handleResumeDragLeave}
                    className={`mt-1 flex flex-col items-center justify-center px-6 pt-5 pb-6 border-2 ${isResumesDragging ? 'border-brand-blue bg-blue-50 dark:bg-blue-900/30' : 'border-gray-300 dark:border-gray-600'} border-dashed rounded-md cursor-pointer hover:border-brand-blue-light transition-colors`}
                >
                    {isResumesDragging ? (
                        <div className="text-center pointer-events-none">
                            <UploadIcon className="mx-auto h-12 w-12 text-brand-blue-light animate-pulse-fast" />
                            <p className="mt-2 font-semibold text-brand-blue-light">Drop resumes here to upload</p>
                        </div>
                    ) : (
                        <div className="space-y-1 text-center pointer-events-none">
                            <UploadIcon className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" />
                            <p className="text-sm text-gray-600 dark:text-gray-400"><span className="font-semibold text-brand-blue-light">Upload files</span> or drag and drop</p>
                            <p className="text-xs text-gray-500 dark:text-gray-500">PDF, DOCX, DOC, TXT</p>
                        </div>
                    )}
                    <input
                        ref={resumeFileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.doc,.docx,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        className="hidden"
                        onChange={handleResumeFileChange}
                    />
                </div>
                 {resumeFiles.length > 0 && (
                    <div className="mt-4 space-y-2 max-h-40 overflow-y-auto p-1">
                        {resumeFiles.map((file, index) => (
                            <div key={`${file.name}-${index}`} className="flex items-center justify-between bg-gray-100 p-2 pl-3 rounded-md dark:bg-gray-700">
                                <p className="text-sm text-brand-text dark:text-gray-200 truncate pr-2">{file.name}</p>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleRemoveResumeFile(index);}} 
                                    className="p-1 text-red-500 hover:text-red-700 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                    aria-label={`Remove ${file.name}`}
                                >
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
              </div>
            </div>
             <div className="mt-6">
              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="w-full flex items-center justify-center py-3 px-4 bg-brand-blue text-white font-semibold rounded-lg shadow-md hover:bg-brand-blue-light focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-blue transition disabled:bg-gray-400 disabled:cursor-not-allowed dark:disabled:bg-gray-600"
              >
                {loading ? (
                  <>
                    <LoadingSpinner />
                    {loadingMessage || 'Analyzing...'}
                  </>
                ) : (
                  <>
                    <SparklesIcon className="w-5 h-5 mr-2" />
                    {resumeFiles.length > 0 ? `Analyze ${resumeFiles.length} Candidate${resumeFiles.length > 1 ? 's' : ''}` : 'Analyze Candidates'}
                  </>
                )}
              </button>
            </div>
          </div>
          
          {/* Output Section */}
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 min-h-[500px] flex flex-col dark:bg-gray-800 dark:border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold flex items-center dark:text-white">
                <SparklesIcon className="w-6 h-6 mr-2 text-brand-blue-light" />
                Analysis Results
              </h2>
              {result && (
                  <button
                    onClick={handleDownloadPdf}
                    disabled={isGeneratingPdf}
                    className="px-3 py-1.5 text-sm font-medium text-brand-blue-light bg-blue-100 rounded-md hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/80 transition-colors flex items-center disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-wait"
                  >
                    {isGeneratingPdf ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-brand-blue-light" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        <DownloadIcon className="w-4 h-4 mr-1.5" />
                        Download PDF
                      </>
                    )}
                  </button>
              )}
            </div>
            {loading && (
              <div className="flex-grow flex flex-col items-center justify-center text-center">
                 <div className="w-16 h-16 border-4 border-brand-blue-light border-t-transparent rounded-full animate-spin mb-4"></div>
                 <p className="text-lg font-semibold text-brand-text dark:text-white">{loadingMessage || 'Analyzing Candidates...'}</p>
                 <p className="text-brand-subtext mt-2 dark:text-gray-400">This may take a moment. The AI is performing a deep semantic analysis.</p>
                 <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4 max-w-md dark:bg-gray-700">
                    <div 
                        className="bg-brand-blue-light h-2.5 rounded-full transition-all duration-300 ease-linear" 
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
              </div>
            )}
            {error && (
              <div className="flex-grow flex items-center justify-center">
                <div className="bg-red-50 border-l-4 border-red-500 text-red-800 p-4 rounded-r-lg relative w-full max-w-2xl dark:bg-red-900/20 dark:border-red-500/50 dark:text-red-200" role="alert">
                  <button
                    onClick={() => setError(null)}
                    className="absolute top-1.5 right-1.5 p-1 text-red-500 rounded-full hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                    aria-label="Close"
                  >
                    <XCircleIcon className="w-5 h-5" />
                  </button>
                  <div className="flex">
                    <div className="py-1">
                      <ExclamationTriangleIcon className="w-6 h-6 text-red-500 mr-4" />
                    </div>
                    <div>
                      <p className="font-bold">Analysis Failed</p>
                      <p className="text-sm mt-1">{error}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {!loading && !error && !result && (
              <div className="flex-grow flex flex-col items-center justify-center text-center text-brand-subtext dark:text-gray-500">
                  <DocumentIcon className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
                  <p className="font-semibold text-lg">Results will appear here</p>
                  <p>Enter a job description and upload resumes to begin.</p>
              </div>
            )}
            {result && (
              <>
                <div className="mb-6 p-4 bg-gray-50 rounded-lg border dark:bg-gray-700/50 dark:border-gray-700">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    <div className="md:col-span-1 relative">
                      <input
                        type="text"
                        placeholder="Search by name or skill..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full p-2 pl-8 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-blue-light dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                      />
                      <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                        <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <FilterIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                        <span className="text-sm font-medium text-brand-subtext dark:text-gray-400">Filter by score:</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          {[
                            { label: 'All', score: 0 },
                            { label: 'Top Tier (>85%)', score: 85 },
                            { label: 'Mid Tier (>70%)', score: 70 },
                            { label: 'Consider (>50%)', score: 50 },
                          ].map(({ label, score }) => (
                            <button
                              key={score}
                              onClick={() => setFilterScore(score)}
                              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${filterScore === score ? 'bg-brand-blue text-white shadow' : 'bg-white text-gray-700 hover:bg-gray-100 border dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600'}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-8">
                  <div>
                    <h3 className="text-lg font-bold text-brand-blue mb-2 dark:text-blue-400">Job Applicant Screening Results</h3>
                    <p className="text-brand-subtext dark:text-gray-400">Role Analyzed: <span className="font-semibold text-brand-text dark:text-gray-200">{result.parsed_job_description.role}</span></p>
                  </div>
                  
                  <div className="space-y-6">
                    {filteredCandidates.length > 0 ? (
                      filteredCandidates.map(candidate => (
                          <CandidateCard key={candidate.rank} candidate={candidate} />
                      ))
                    ) : (
                      <div className="text-center py-10 text-brand-subtext bg-gray-50 rounded-lg dark:bg-gray-900/50 dark:text-gray-500">
                          <p className="font-semibold text-lg">No Candidates Match Your Filters</p>
                          <p className="text-sm mt-1">Try adjusting your search or filter settings.</p>
                      </div>
                    )}
                  </div>

                  <div className="pt-6 border-t dark:border-gray-700">
                     <h3 className="text-lg font-bold text-brand-blue mb-3 dark:text-blue-400">Bias Analysis Report</h3>
                    <div className="space-y-3">
                    {result.bias_analysis.bias_flags.length > 0 ? (
                        result.bias_analysis.bias_flags.map((item, index) => (
                        <div key={index} className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg dark:bg-yellow-900/30 dark:border-yellow-500">
                            <div className="flex justify-between items-center">
                                <p className="font-semibold text-yellow-800 dark:text-yellow-200">{item.category}</p>
                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                    item.severity === 'High' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                                    item.severity === 'Medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                                    'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                                }`}>
                                    {item.severity}
                                </span>
                            </div>
                            <p className="text-yellow-700 dark:text-yellow-300 mt-1">{item.flag}</p>
                        </div>
                        ))
                    ) : (
                        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-r-lg dark:bg-green-900/30 dark:border-green-500">
                            <p className="text-green-800 dark:text-green-300">No concerning biases detected.</p>
                        </div>
                    )}
                    </div>
                  </div>


                  <div className="pt-6 border-t dark:border-gray-700">
                    <h3 className="text-lg font-bold text-brand-blue mb-2 dark:text-blue-400">Final Recommendation</h3>
                    <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-r-lg dark:bg-green-900/30 dark:border-green-500">
                      <p className="text-brand-text dark:text-gray-200"><strong>Top Candidate:</strong> {result.final_recommendation.top_candidate}</p>
                      <p className="text-brand-subtext dark:text-gray-400 mt-1">{result.final_recommendation.reasoning}</p>
                    </div>
                  </div>

                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;