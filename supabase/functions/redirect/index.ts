import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // POST: create short link
  if (req.method === "POST") {
    try {
      const { long_url, user_id, campaign } = await req.json();

      if (!long_url) {
        return new Response(JSON.stringify({ error: "long_url required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const shortCode = Math.random().toString(36).substring(2, 8).toLowerCase();

      const { error } = await supabase.from("short_links").insert({
        short_code: shortCode,
        long_url,
        user_id: user_id || null,
        campaign: campaign || "unknown",
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (error) {
        console.error("[REDIRECT] Insert error:", error);
        return new Response(JSON.stringify({ error: "Failed to create link" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const baseUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/redirect`;
      return new Response(
        JSON.stringify({ short_url: `${baseUrl}?c=${shortCode}`, short_code: shortCode }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("[REDIRECT] Error:", err);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // GET: redirect by short code
  const shortCode = url.searchParams.get("c");

  if (!shortCode) {
    // Fallback: redirect to main site
    return new Response(null, {
      status: 302,
      headers: { Location: "https://finaxai.vercel.app" },
    });
  }

  const { data: link } = await supabase
    .from("short_links")
    .select("*")
    .eq("short_code", shortCode)
    .single();

  if (!link) {
    return new Response(null, {
      status: 302,
      headers: { Location: "https://finaxai.vercel.app" },
    });
  }

  // Check expiry
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return new Response(null, {
      status: 302,
      headers: { Location: "https://finaxai.vercel.app" },
    });
  }

  // Increment clicks (fire-and-forget)
  supabase
    .from("short_links")
    .update({ clicks: (link.clicks || 0) + 1 })
    .eq("short_code", shortCode)
    .then(() => {});

  return new Response(null, {
    status: 302,
    headers: { Location: link.long_url },
  });
});
