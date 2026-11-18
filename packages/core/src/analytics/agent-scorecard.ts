export interface AgentScorecard {
  agentId: string;
  agentName: string;
  rank: number;
  callsHandled: number;
  averageCsat: number;
  firstContactResolutionPercent: number;
  averageHandleTimeSeconds: number;
  copilotAdoptionPercent: number;
  overallQaScore: number;
  badges: string[];
}

export class AgentScorecardService {
  public getTenantLeaderboard(_tenantId: string): AgentScorecard[] {
    const rawAgents: Omit<AgentScorecard, 'rank'>[] = [
      {
        agentId: 'ag-1',
        agentName: 'Sarah Agent',
        callsHandled: 48,
        averageCsat: 4.9,
        firstContactResolutionPercent: 94,
        averageHandleTimeSeconds: 142,
        copilotAdoptionPercent: 96,
        overallQaScore: 97,
        badges: ['Top CSAT Star', 'Fastest Emergency Dispatch', '100% Compliance'],
      },
      {
        agentId: 'ag-3',
        agentName: 'Elena Rostova',
        callsHandled: 41,
        averageCsat: 4.8,
        firstContactResolutionPercent: 91,
        averageHandleTimeSeconds: 158,
        copilotAdoptionPercent: 92,
        overallQaScore: 94,
        badges: ['Bilingual Champion (EN/ES)', 'Zero-Escalation Streak'],
      },
      {
        agentId: 'ag-2',
        agentName: 'Marcus Vance',
        callsHandled: 53,
        averageCsat: 4.7,
        firstContactResolutionPercent: 89,
        averageHandleTimeSeconds: 165,
        copilotAdoptionPercent: 85,
        overallQaScore: 91,
        badges: ['Senior HVAC Specialist', 'High Volume Leader'],
      },
    ];

    return rawAgents
      .sort((a, b) => b.overallQaScore - a.overallQaScore)
      .map((item, idx) => ({
        rank: idx + 1,
        ...item,
      }));
  }
}
