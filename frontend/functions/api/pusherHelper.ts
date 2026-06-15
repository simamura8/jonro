import crypto from "node:crypto";

interface PusherConfig {
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

export async function triggerPusher(
  config: PusherConfig,
  channel: string,
  event: string,
  payload: any
) {
  const { appId, key, secret, cluster } = config;
  const path = `/apps/${appId}/events`;
  const body = JSON.stringify({
    name: event,
    channels: [channel],
    data: JSON.stringify(payload),
  });

  // BodyのMD5ハッシュを作成
  const bodyMd5 = crypto.createHash("md5").update(body).digest("hex");
  const timestamp = Math.floor(Date.now() / 1000);

  const queryParams = [
    `auth_key=${key}`,
    `auth_timestamp=${timestamp}`,
    `auth_version=1.0`,
    `body_md5=${bodyMd5}`,
  ].join("&");

  const signData = `POST\n${path}\n${queryParams}`;

  // HMAC-SHA256署名を作成
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signData)
    .digest("hex");

  const url = `https://api-${cluster}.pusher.com${path}?${queryParams}&auth_signature=${signature}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pusher trigger failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

export function authorizeChannel(
  config: Omit<PusherConfig, "appId" | "cluster">,
  socketId: string,
  channelName: string,
  presenceData?: any
) {
  const { key, secret } = config;
  
  let stringToSign = `${socketId}:${channelName}`;
  let channelDataStr = "";

  if (presenceData) {
    channelDataStr = JSON.stringify(presenceData);
    stringToSign += `:${channelDataStr}`;
  }

  const signature = crypto
    .createHmac("sha256", secret)
    .update(stringToSign)
    .digest("hex");

  const auth = `${key}:${signature}`;

  const response: any = { auth };
  if (presenceData) {
    response.channel_data = channelDataStr;
  }

  return response;
}
