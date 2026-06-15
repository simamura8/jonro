interface Env {
  PUSHER_APP_ID: string;
  PUSHER_KEY: string;
  PUSHER_SECRET: string;
  PUSHER_CLUSTER: string;
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const info = {
    PUSHER_APP_ID: context.env.PUSHER_APP_ID ? `set (${context.env.PUSHER_APP_ID})` : 'UNDEFINED',
    PUSHER_KEY: context.env.PUSHER_KEY ? `set (${context.env.PUSHER_KEY.slice(0, 6)}...)` : 'UNDEFINED',
    PUSHER_SECRET: context.env.PUSHER_SECRET ? 'set (hidden)' : 'UNDEFINED',
    PUSHER_CLUSTER: context.env.PUSHER_CLUSTER ? `set (${context.env.PUSHER_CLUSTER})` : 'UNDEFINED',
    DB: context.env.DB ? 'bound' : 'UNDEFINED',
  };

  return new Response(JSON.stringify(info, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
