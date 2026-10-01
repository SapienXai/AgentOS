export declare const CERTIFICATION_DOCUMENTATION_PATH_RULES: readonly RegExp[];

export declare function getCertificationEvidencePathForVersion(version: string, phase?: string): string;

export declare function getCurrentCertificationTarget(repoRoot: string): {
  version: string;
  phase: string;
  evidencePath: string;
};

export declare function resolveCertificationEvidenceSelection(input: {
  repoRoot?: string;
  evidencePath?: string;
  version?: string;
}): { evidencePath: string; version: string | null };

export declare function isCertificationDocumentationPath(filePath: string): boolean;

export declare function classifyCertificationChangedPaths(changedPaths: string[]): {
  changedPaths: string[];
  documentationOnlyPaths: string[];
  meaningfulPaths: string[];
};

export declare function evaluateCertificationFreshness(input: {
  certifiedCodeHead: string | null;
  currentHead: string | null;
  changedPaths: string[];
  certifiedCodeIsAncestor?: boolean;
  certificationSuccess?: boolean;
}): {
  ok: boolean;
  status: string;
  reason: string;
  certifiedCodeHead: string | null;
  currentHead: string | null;
  changedPaths: string[];
  documentationOnlyPaths: string[];
  meaningfulPaths: string[];
};

export declare function checkCertificationFreshness(input: {
  repoRoot: string;
  evidencePath?: string;
  expectedVersion?: string;
  currentHead?: string;
}): ReturnType<typeof evaluateCertificationFreshness> & {
  expectedVersion?: string | null;
  actualVersion?: string | null;
  expectedArtifactType?: string | null;
  evidencePath?: string;
};

export declare function main(argv?: string[]): ReturnType<typeof checkCertificationFreshness> | null;
