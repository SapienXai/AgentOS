export type FinalizedReleaseAssets = {
  latest: {
    version: string;
    notes: string;
    pub_date: string;
    platforms: Record<string, { url: string; signature: string }>;
  };
  assets: string[];
};

export function finalizeReleaseAssets(input: {
  root: string;
  version: string;
  now?: Date;
}): Promise<FinalizedReleaseAssets>;
