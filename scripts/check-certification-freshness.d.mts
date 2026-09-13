export declare const DEFAULT_CERTIFICATION_EVIDENCE_PATH: string;
export declare const CERTIFICATION_DOCUMENTATION_PATH_RULES: readonly RegExp[];

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
  currentHead?: string;
}): ReturnType<typeof evaluateCertificationFreshness>;

export declare function main(argv?: string[]): ReturnType<typeof checkCertificationFreshness> | null;
