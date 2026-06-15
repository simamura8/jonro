import { authorizeChannel } from "../pusherHelper";

interface Env {
  PUSHER_APP_ID: string;
  PUSHER_KEY: string;
  PUSHER_SECRET: string;
  PUSHER_CLUSTER: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const formData = await context.request.formData();
    const socketId = formData.get("socket_id") as string;
    const channelName = formData.get("channel_name") as string;
    const name = formData.get("name") as string || "Anonymous";

    if (!socketId || !channelName) {
      return new Response("Missing socket_id or channel_name", { status: 400 });
    }

    const pusherConfig = {
      key: context.env.PUSHER_KEY,
      secret: context.env.PUSHER_SECRET,
    };

    const presenceData = {
      user_id: socketId,
      user_info: {
        name: name,
      },
    };

    const authResponse = authorizeChannel(pusherConfig, socketId, channelName, presenceData);
    return new Response(JSON.stringify(authResponse), {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      },
    });
  } catch (error: any) {
    return new Response(error.message || "Internal Server Error", { status: 500 });
  }
};

// CORS対応のためのOPTIONSハンドラ
export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    },
  });
};
