import jsPDF from 'jspdf';
import { AnalysisResult, CandidateResult, BiasFlag } from '../types';

// Constants for PDF layout
const MARGIN = 15;
const FONT_SIZES = {
    H1: 20,
    H2: 16,
    H3: 12,
    BODY: 10,
    SMALL: 8,
};
const LINE_HEIGHT_MULTIPLIER = 1.5;
const FOOTER_HEIGHT = 10;

class PdfBuilder {
    doc: jsPDF;
    y: number;
    pageWidth: number;
    pageHeight: number;
    contentWidth: number;
    pageNumber: number;
    
    constructor() {
        this.doc = new jsPDF('p', 'mm', 'a4');
        this.pageWidth = this.doc.internal.pageSize.getWidth();
        this.pageHeight = this.doc.internal.pageSize.getHeight();
        this.contentWidth = this.pageWidth - MARGIN * 2;
        this.y = 0; // Will be set by addPage
        this.pageNumber = 0; // Will be set by addPage
        this.addPage();
    }
    
    addPage(): void {
        if (this.pageNumber > 0) {
            this.doc.addPage();
        }
        this.pageNumber++;
        this.y = MARGIN;
        this.addPageHeader();
    }

    addPageHeader(): void {
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(FONT_SIZES.SMALL);
        this.doc.setTextColor(150, 150, 150);
        this.doc.text('HR Screener AI Report', MARGIN, MARGIN / 2);
        this.doc.line(MARGIN, MARGIN / 2 + 2, this.pageWidth - MARGIN, MARGIN / 2 + 2);
    }
    
    finalizeAndAddFooters(): void {
        const totalPages = this.doc.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            this.doc.setPage(i);
            const footerY = this.pageHeight - FOOTER_HEIGHT;
            this.doc.setFont('helvetica', 'normal');
            this.doc.setFontSize(FONT_SIZES.SMALL);
            this.doc.setTextColor(150, 150, 150);
            this.doc.line(MARGIN, footerY, this.pageWidth - MARGIN, footerY);
            const pageStr = `Page ${i} of ${totalPages}`;
            this.doc.text(pageStr, this.pageWidth / 2, footerY + 6, { align: 'center' });
        }
    }
    
    checkAndAddPage(requiredHeight: number): void {
        if (this.y + requiredHeight > this.pageHeight - MARGIN - FOOTER_HEIGHT) {
            this.addPage();
        }
    }

    addHeader(text: string): void {
        this.checkAndAddPage(20);
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(FONT_SIZES.H1);
        this.doc.setTextColor(30, 64, 175);
        this.doc.text(text, this.pageWidth / 2, this.y, { align: 'center' });
        this.y += FONT_SIZES.H1 * 0.7;
    }

    addSubheader(text: string): void {
        this.checkAndAddPage(15);
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(FONT_SIZES.H2);
        this.doc.setTextColor(37, 99, 235);
        this.doc.text(text, MARGIN, this.y);
        this.y += FONT_SIZES.H2 * 0.9;
    }
    
    addSectionTitle(text: string): void {
        this.checkAndAddPage(10);
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(FONT_SIZES.H3);
        this.doc.setTextColor(17, 24, 39);
        this.doc.text(text, MARGIN, this.y);
        this.y += FONT_SIZES.H3 * 0.7;
    }

    addBodyText(text: string | number | undefined, options: { fontStyle?: string, color?: number[] } = {}): void {
        if (text === undefined) return;
        const { fontStyle = 'normal', color = [75, 85, 99] } = options;
        const textLines = this.doc.splitTextToSize(String(text), this.contentWidth);
        const textHeight = textLines.length * (FONT_SIZES.BODY * 0.352778) * LINE_HEIGHT_MULTIPLIER;
        this.checkAndAddPage(textHeight);

        this.doc.setFont('helvetica', fontStyle);
        this.doc.setFontSize(FONT_SIZES.BODY);
        this.doc.setTextColor(color[0], color[1], color[2]);
        this.doc.text(textLines, MARGIN, this.y, { lineHeightFactor: LINE_HEIGHT_MULTIPLIER });
        this.y += textHeight;
    }

    addBulletList(items: string[]): void {
        if (!items || items.length === 0) {
            this.addBodyText('None listed', {fontStyle: 'italic'});
            return;
        }
        items.forEach(item => {
            const textLines = this.doc.splitTextToSize(item, this.contentWidth - 5);
            const textHeight = textLines.length * (FONT_SIZES.BODY * 0.352778) * LINE_HEIGHT_MULTIPLIER;
            this.checkAndAddPage(textHeight);

            this.doc.setFont('helvetica', 'normal');
            this.doc.setFontSize(FONT_SIZES.BODY);
            this.doc.setTextColor(75, 85, 99);
            this.doc.text('•', MARGIN + 2, this.y, {lineHeightFactor: LINE_HEIGHT_MULTIPLIER});
            this.doc.text(textLines, MARGIN + 5, this.y, { lineHeightFactor: LINE_HEIGHT_MULTIPLIER });
            this.y += textHeight;
        });
    }

    addScoreGrid(scores: CandidateResult['scores']): void {
        const scoreItems = [
            { label: 'Semantic Fit', score: scores.semantic_relevance_score },
            { label: 'Skill Match', score: scores.skill_match_score },
            { label: 'Experience Match', score: scores.experience_match_score },
            { label: 'Education Match', score: scores.education_match_score },
        ];
        const itemWidth = this.contentWidth / 4;
        this.checkAndAddPage(20);

        scoreItems.forEach((item, index) => {
            this.doc.setFont('helvetica', 'bold');
            this.doc.setFontSize(FONT_SIZES.H3);
            this.doc.setTextColor(17, 24, 39);
            this.doc.text(`${Math.round(item.score)}%`, MARGIN + (itemWidth * index) + (itemWidth / 2), this.y, { align: 'center' });
            
            this.doc.setFont('helvetica', 'normal');
            this.doc.setFontSize(FONT_SIZES.SMALL);
            this.doc.setTextColor(75, 85, 99);
            this.doc.text(item.label, MARGIN + (itemWidth * index) + (itemWidth / 2), this.y + 5, { align: 'center' });
        });
        this.y += 15;
    }
    
    addSummaryTable(candidates: CandidateResult[]): void {
        const head = [['Rank', 'Name', 'Overall', 'Skill', 'Experience']];
        const body = candidates.map(c => ([
            c.rank,
            c.parsed_resume.name,
            `${Math.round(c.scores.overall_match_score)}%`,
            `${Math.round(c.scores.skill_match_score)}%`,
            `${Math.round(c.scores.experience_match_score)}%`,
        ]));
        
        const rowHeight = 8;
        const startY = this.y;
        const colWidths = [15, 85, 25, 25, 25];

        this.checkAndAddPage((body.length + 1) * rowHeight);
        
        // Header
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(FONT_SIZES.BODY);
        this.doc.setFillColor(243, 244, 246);
        this.doc.rect(MARGIN, this.y, this.contentWidth, rowHeight, 'F');
        let currentX = MARGIN;
        head[0].forEach((header, i) => {
            this.doc.text(String(header), currentX + 3, this.y + 5.5);
            currentX += colWidths[i];
        });
        this.y += rowHeight;

        // Body
        this.doc.setFont('helvetica', 'normal');
        body.forEach((row, rowIndex) => {
            if (rowIndex % 2 !== 0) {
                this.doc.setFillColor(249, 250, 251); // bg-gray-50
                this.doc.rect(MARGIN, this.y, this.contentWidth, rowHeight, 'F');
            }
            let currentX = MARGIN;
            row.forEach((cell, i) => {
                const text = this.doc.splitTextToSize(String(cell), colWidths[i] - 6);
                this.doc.text(text, currentX + 3, this.y + 5.5);
                currentX += colWidths[i];
            });
            this.y += rowHeight;
        });
        
        this.doc.setDrawColor(209, 213, 219); // gray-300
        this.doc.rect(MARGIN, startY, this.contentWidth, this.y - startY);
        let x = MARGIN;
        colWidths.slice(0, -1).forEach(w => {
            x += w;
            this.doc.line(x, startY, x, this.y);
        });
        this.y += 5;
    }

    addSeparator(): void {
        this.checkAndAddPage(10);
        this.y += 5;
        this.doc.setDrawColor(229, 231, 235); // gray-200
        this.doc.line(MARGIN, this.y, this.pageWidth - MARGIN, this.y);
        this.y += 5;
    }
    
    addStyledSection(title: string, content: () => void) {
        this.checkAndAddPage(15); // Min height for a section
        const startY = this.y;
        this.y += 5; 
        
        this.addSectionTitle(title);
        this.y += 2; 
        
        const contentStartY = this.y;
        content();
        const contentEndY = this.y;
        
        this.y += 5; 
        const endY = this.y;

        // Check if the content spanned a page break
        if (Math.floor((startY-0.1) / this.pageHeight) !== Math.floor((endY-0.1) / this.pageHeight)) {
            // Content broke across pages, so just redraw content without box
            this.y = contentStartY - 7;
            this.addSectionTitle(title);
            this.y +=2;
            content();
            this.y = endY;
            return;
        }
        
        this.doc.setFillColor(243, 244, 246);
        this.doc.rect(MARGIN, startY, this.contentWidth, endY - startY, 'F');
        
        // Redraw content on top
        this.y = contentStartY - 7;
        this.addSectionTitle(title);
        this.y += 2;
        content();
        this.y = endY;
    }
}

const addCandidateDetails = (builder: PdfBuilder, candidate: CandidateResult) => {
    const estimatedHeight = 150; // A rough guess to decide if we need a new page
    builder.checkAndAddPage(estimatedHeight);

    const candidateHeader = `Rank ${candidate.rank}: ${candidate.parsed_resume.name}`;
    builder.addSectionTitle(candidateHeader);
    builder.addBodyText(`Overall Match: ${Math.round(candidate.scores.overall_match_score)}%`, { fontStyle: 'bold' });
    builder.y += 5;

    builder.addScoreGrid(candidate.scores);
    builder.y += 5;
    
    builder.addSectionTitle('Reasoning for Rank');
    builder.addBodyText(candidate.reasoning);
    builder.y += 5;

    builder.addSectionTitle('Strengths');
    builder.addBulletList(candidate.strengths);
    builder.y += 5;
    
    builder.addSectionTitle('Weaknesses');
    builder.addBulletList(candidate.weaknesses);
    builder.y += 5;

    builder.addSectionTitle('Fit Assessment');
    builder.addBulletList(candidate.fit_assessment);
};

export const generatePdf = (result: AnalysisResult): void => {
    const builder = new PdfBuilder();
    
    // Cover Page content
    builder.addHeader("Job Applicant Screening Results");
    builder.y += 5;
    builder.addBodyText(`Role Analyzed: ${result.parsed_job_description.role}`, { fontStyle: 'bold' });
    builder.addBodyText(`Date Generated: ${new Date().toLocaleDateString()}`);
    builder.addSeparator();

    // Summary Table
    builder.addSubheader("Candidate Summary");
    builder.addSummaryTable(result.ranked_candidates);
    
    // Detailed Analysis
    builder.addPage();
    builder.addSubheader("Detailed Candidate Analysis");
    builder.y += 5;

    result.ranked_candidates.forEach((candidate, index) => {
        addCandidateDetails(builder, candidate);
        if (index < result.ranked_candidates.length - 1) {
             builder.addSeparator();
        }
    });
    
    // Final Sections
    builder.checkAndAddPage(80); 
    builder.addSeparator();

    const renderBiasAnalysis = () => {
        const flags = result.bias_analysis.bias_flags;
        if (flags.length > 0) {
            flags.forEach((flag: BiasFlag) => {
                builder.addBodyText(`${flag.category} (${flag.severity})`, { fontStyle: 'bold' });
                builder.addBulletList([flag.flag]);
                builder.y += 2;
            });
        } else {
            builder.addBodyText('No concerning biases detected.', { color: [22, 101, 52] });
        }
    };
    builder.addStyledSection('Bias Analysis Report', renderBiasAnalysis);
    builder.y += 10;
    
    const renderRecommendation = () => {
        builder.addBodyText(`Top Candidate: ${result.final_recommendation.top_candidate}`, { fontStyle: 'bold' });
        builder.addBodyText(result.final_recommendation.reasoning);
    };
    builder.addStyledSection('Final Recommendation', renderRecommendation);

    builder.finalizeAndAddFooters();
    builder.doc.save(`HR_Screening_Report_${result.parsed_job_description.role.replace(/\s/g, '_')}.pdf`);
};