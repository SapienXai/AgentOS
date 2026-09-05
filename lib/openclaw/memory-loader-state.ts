import type {
  WorkerMemoryAction,
  WorkerMemoryActionResponse,
  WorkerMemoryDreamDiaryResponse,
  WorkerMemoryProjection,
  WorkerMemorySearchResponse
} from "@/lib/openclaw/memory-types";

export type NativeMemoryRequestKind = "status" | "diary" | "search" | "action";

export type NativeMemoryRequestToken = {
  agentId: string;
  generation: number;
  sequence: number;
  kind: NativeMemoryRequestKind;
};

export type NativeMemoryLoaderState = {
  agentId: string | null;
  projection: WorkerMemoryProjection | null;
  diary: WorkerMemoryDreamDiaryResponse | null;
  searchResult: WorkerMemorySearchResponse | null;
  isLoadingStatus: boolean;
  isLoadingDiary: boolean;
  isSearching: boolean;
  activeAction: WorkerMemoryAction | null;
  actionResult: WorkerMemoryActionResponse | null;
  error: string | null;
};

export function createNativeMemoryLoaderState(agentId: string | null): NativeMemoryLoaderState {
  return {
    agentId,
    projection: null,
    diary: null,
    searchResult: null,
    isLoadingStatus: false,
    isLoadingDiary: false,
    isSearching: false,
    activeAction: null,
    actionResult: null,
    error: null
  };
}

export class NativeMemoryRequestLedger {
  private agentId: string | null;
  private generation = 0;
  private sequence = 0;
  private readonly latest = new Map<NativeMemoryRequestKind, number>();

  constructor(agentId: string | null) {
    this.agentId = agentId;
  }

  getCurrentAgentId() {
    return this.agentId;
  }

  switchAgent(agentId: string | null) {
    if (this.agentId === agentId) return;
    this.agentId = agentId;
    this.generation += 1;
    this.latest.clear();
  }

  begin(kind: NativeMemoryRequestKind, agentId: string): NativeMemoryRequestToken {
    if (this.agentId !== agentId) {
      this.switchAgent(agentId);
    }
    const sequence = ++this.sequence;
    this.latest.set(kind, sequence);
    return { agentId, generation: this.generation, sequence, kind };
  }

  isCurrent(token: NativeMemoryRequestToken, currentAgentId = this.agentId) {
    return token.agentId === currentAgentId
      && token.agentId === this.agentId
      && token.generation === this.generation
      && this.latest.get(token.kind) === token.sequence;
  }
}
