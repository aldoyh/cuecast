export const GITHUB_SECRETS_URL =
  "https://github.com/aldoyh/cuecast/settings/secrets/actions";

export const GITHUB_ACTIONS_URL =
  "https://github.com/aldoyh/cuecast/actions/workflows/cuecast.yml";

export type SecretSpec = {
  name: string;
  env: string[];
  required: boolean;
  usedFor: string;
};

export const YOUTUBE_SECRETS: SecretSpec[] = [
  {
    name: "YOUTUBE_CLIENT_ID",
    env: ["YOUTUBE_CLIENT_ID", "CUECAST_CLIENT_ID"],
    required: true,
    usedFor: "OAuth client that mints the access token",
  },
  {
    name: "YOUTUBE_CLIENT_SECRET",
    env: ["YOUTUBE_CLIENT_SECRET", "CUECAST_CLIENT_SECRET"],
    required: true,
    usedFor: "OAuth client secret — never logged, never committed",
  },
  {
    name: "YOUTUBE_REFRESH_TOKEN",
    env: ["YOUTUBE_REFRESH_TOKEN", "CUECAST_REFRESH_TOKEN"],
    required: true,
    usedFor: "Offline YouTube scope. Exchanged for a short-lived Bearer token at run time",
  },
  {
    name: "CUECAST_ICAL",
    env: ["CUECAST_ICAL", "ICAL_URL"],
    required: false,
    usedFor: "Private iCal URL. Leave empty to use the public Live Shows feed",
  },
];

export const PIPELINE = [
  {
    n: "1",
    title: "Google Cloud",
    body: "Enable YouTube Data API v3. Create a Desktop OAuth client. Scope youtube.",
  },
  {
    n: "2",
    title: "Refresh token",
    body: "One-time consent. The refresh token is the only long-lived secret Cuecast stores.",
  },
  {
    n: "3",
    title: "GitHub Secrets",
    body: "Encrypted at rest. Injected as env vars into the Actions runner. Never written to the repo.",
  },
  {
    n: "4",
    title: "YouTube Live",
    body: "PHP exchanges the refresh token, then insert / update / thumbnail with the Bearer token.",
  },
] as const;
