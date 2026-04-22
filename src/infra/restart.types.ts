export type RestartAttempt = {
  ok: boolean;
  method: "launchctl" | "launchd" | "systemd" | "schtasks" | "supervisor";
  detail?: string;
  tried?: string[];
};
