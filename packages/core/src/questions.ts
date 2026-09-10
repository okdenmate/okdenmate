/**
 * Open questions register.
 *
 * Brief Layer 5. These are not notes; they are the reason half the numbers in
 * this system carry an Assumed tag. Holding them in the CRM means every screen
 * that shows a weak figure can say which question would strengthen it, and the
 * weekly review has a list rather than a memory.
 */

export type QuestionTier = 1 | 2 | 3;
export type QuestionStatus = 'open' | 'chasing' | 'answered' | 'dropped';

export interface OpenQuestion {
  id: string;
  tier: QuestionTier;
  business: 'UKN' | 'RW' | 'BOTH';
  question: string;
  whyItMatters: string;
  howToAnswer: string;
  consequenceIfUnanswered: string;
  owner: string;
  /** Engines and figures that stay assumed until this is answered. */
  blocks: string[];
  status: QuestionStatus;
  answer: string | null;
  answeredAt: string | null;
}

export const SEED_QUESTIONS: OpenQuestion[] = [
  {
    id: 'Q2',
    tier: 1,
    business: 'UKN',
    question: 'What is the buy and sell price on specialty nitrates, even roughly?',
    whyItMatters:
      'Every funnel projection assumes 20-30% gross margin. If the real figure is 10% or 40%, ' +
      'the forecast is wrong by a factor of two to four.',
    howToAnswer: 'Ask Tom for three to five recent specialty orders with price and cost.',
    consequenceIfUnanswered: 'No specialty margin figure in this system can be relied on.',
    owner: 'Tom',
    blocks: ['mixshift', 'forecast', 'margin bands', 'commission projection'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q4',
    tier: 2,
    business: 'UKN',
    question: 'How many nitrate customers are there in total?',
    whyItMatters:
      'If it is two or three, the growth pitch is a concentration risk. If it is thirty, it is ' +
      'an unworked book. These lead to opposite plans.',
    howToAnswer: 'Ask Tom for the customer list by account revenue.',
    consequenceIfUnanswered: 'Concentration cannot be measured and the growth plan has no base.',
    owner: 'Tom',
    blocks: ['concentration', 'account planning'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q3',
    tier: 2,
    business: 'UKN',
    question: 'What is the storage fee, and how much spare capacity is there?',
    whyItMatters:
      'Storage is the only recurring revenue line in either business, and the user earns 25% of ' +
      'it every month.',
    howToAnswer: 'Ask Tom for the fee schedule; count the pallet positions on site.',
    consequenceIfUnanswered: 'Storage revenue cannot be raised, forecast or commissioned.',
    owner: 'Tom',
    blocks: ['storage ledger', 'recurring commission', 'capacity model'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q5',
    tier: 2,
    business: 'UKN',
    question: 'What grade is the sodium nitrate currently in stock: food, technical or fertiliser?',
    whyItMatters: 'Food grade prices 30-50% above technical, and it changes the target segment entirely.',
    howToAnswer: 'Photograph the bag label.',
    consequenceIfUnanswered: 'The specialty margin claim cannot be made with confidence.',
    owner: 'User',
    blocks: ['product catalogue', 'mixshift routing'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q11',
    tier: 1,
    business: 'UKN',
    question: 'What is the current enquiry volume and conversion rate?',
    whyItMatters:
      'Both primary contact routes on the live site are broken, so there is no reliable enquiry ' +
      'history to plan against.',
    howToAnswer:
      'Fix the broken routes, point them at the intake endpoint in this system, then read the ' +
      'funnel after a full month.',
    consequenceIfUnanswered: 'No baseline, so no way to evaluate any marketing spend.',
    owner: 'User',
    blocks: ['funnel benchmarks', 'stage probabilities', 'pipeline forecast'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q12',
    tier: 1,
    business: 'BOTH',
    question: 'Does the new-account commission rate apply to that account’s later orders?',
    whyItMatters:
      'It is not written down. If the 25% rate is first-order-only, every projection halves.',
    howToAnswer: 'Put it in the compensation agreement in writing before implementation.',
    consequenceIfUnanswered: 'The user is working without knowing what a won account is worth.',
    owner: 'User + Tom',
    blocks: ['commission engine', 'earnings projection'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q13',
    tier: 3,
    business: 'UKN',
    question: 'Have the NAMOS and NIHHS notifications been filed, and what is the peak tonnage ever held?',
    whyItMatters:
      'The storage pitch is that the customer outsources a regulatory duty. That only sells if the ' +
      'duty is demonstrably discharged. Unfiled notifications turn it from a moat into a liability.',
    howToAnswer: 'Ask Tom; reconstruct peak holdings from goods-in records.',
    consequenceIfUnanswered: 'Storage cannot be pitched, and the site may already be in breach.',
    owner: 'Tom',
    blocks: ['storage pitch readiness', 'threshold alarms'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q18',
    tier: 1,
    business: 'BOTH',
    question: 'Is analytics installed on either site?',
    whyItMatters:
      'Every funnel event designed for the web pages pushes to a data layer. With no analytics ' +
      'present they fire into nothing.',
    howToAnswer: 'View source on both sites, or check the Google Analytics and Tag Manager accounts.',
    consequenceIfUnanswered: 'No arrival or engagement data, so the top of the funnel stays dark.',
    owner: 'User',
    blocks: ['funnel arrivals', 'engagement rate'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q14',
    tier: 3,
    business: 'UKN',
    question: 'What is in the blue IBCs stored in the same bay as the nitrates?',
    whyItMatters: 'Segregation of an oxidiser from unidentified material is unverified.',
    howToAnswer: 'Read the labels; record them against the segregation plan.',
    consequenceIfUnanswered: 'A segregation failure is invisible until an inspection finds it.',
    owner: 'User',
    blocks: ['site compliance'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q15',
    tier: 3,
    business: 'UKN',
    question: 'How many pallet positions does the racking hold?',
    whyItMatters: 'Refines the storage capacity model and the revenue ceiling on the shed.',
    howToAnswer: 'Count them.',
    consequenceIfUnanswered: 'The capacity model stays loose.',
    owner: 'User',
    blocks: ['capacity model'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q16',
    tier: 3,
    business: 'UKN',
    question: 'What was the exact bag count and price per bag on the largest ammonium nitrate order?',
    whyItMatters: 'Converts the AN pricing figures from estimated to verified.',
    howToAnswer: 'Read the invoice.',
    consequenceIfUnanswered: 'The commodity margin band stays an inference from public prices.',
    owner: 'User',
    blocks: ['price anchors', 'commodity margin band'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
  {
    id: 'Q1',
    tier: 2,
    business: 'UKN',
    question: 'What is monthly nitrate revenue, separate from flooring?',
    whyItMatters: 'Decides whether UK Nitrates is profitable standing alone or a cash burn.',
    howToAnswer: 'Ask Tom.',
    consequenceIfUnanswered: 'The growth case is argued without knowing the starting position.',
    owner: 'Tom',
    blocks: ['business case'],
    status: 'open',
    answer: null,
    answeredAt: null,
  },
];

export interface QuestionImpact {
  questionId: string;
  tier: QuestionTier;
  question: string;
  blocks: string[];
  /** Rough count of live figures that would firm up if this were answered. */
  weight: number;
}

/** Order the register by how much it would unlock, so the chase list writes itself. */
export function prioritiseQuestions(questions: OpenQuestion[]): QuestionImpact[] {
  return questions
    .filter((q) => q.status === 'open' || q.status === 'chasing')
    .map((q) => ({
      questionId: q.id,
      tier: q.tier,
      question: q.question,
      blocks: q.blocks,
      weight: (4 - q.tier) * 10 + q.blocks.length * 3,
    }))
    .sort((a, b) => b.weight - a.weight);
}
