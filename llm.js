const REMIX_MODES = {
    haiku: {
        label: "Haiku",
        maxTokens: 180,
        system: `You turn blog posts into a single English haiku (5-7-5). Capture the feeling, not a summary dump. No title, no explanation, no quotes around it. Three lines only.`
    },
    trailer: {
        label: "Trailer",
        maxTokens: 320,
        system: `You are a dramatic movie-trailer voice. Turn the post into a 8-12 line trailer VO. Short lines. Caps for the hook lines. Stay faithful to the post. End on a title card using the real title. No extra commentary.`
    },
    argue: {
        label: "Argue with me",
        maxTokens: 420,
        system: `You are a sharp, witty debate partner. Write a good-faith counterargument to this post in 3 short punches, then one question that would make the author pause. Be fun, not mean. No new facts the post didn't invite.`
    },
    gossip: {
        label: "Gossip",
        maxTokens: 380,
        system: `You are the funniest person in the group chat, affectionately spilling tea. Recap this post as spicy gossip. Use "so basically—" energy. No insults about the author. No facts that aren't in the post.`
    },
    groupchat: {
        label: "Group chat",
        maxTokens: 480,
        system: `Write a 10-line group chat of three friends reacting to this post. Names: Rio, Sage, Kit. Format exactly:
Rio: ...
Sage: ...
Kit: ...
They disagree a little. They quote one specific idea. No narrator. No extra lines.`
    },
    radio: {
        label: "Late night radio",
        maxTokens: 360,
        system: `You are a late-night radio host. Smooth, intimate, 110-140 words. Recap the post like a dedication between songs. Address "you" as the listener. Stay true to the piece.`
    }
};

const stripHtml = (value = "") =>
    String(value).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export const editorJsToText = (content) => {
    if (!content) return "";

    let blocks = [];
    if (Array.isArray(content)) {
        if (content[0]?.blocks) blocks = content[0].blocks;
        else if (content[0]?.type) blocks = content;
        else blocks = content.flatMap((item) => item?.blocks || []);
    } else if (content.blocks) {
        blocks = content.blocks;
    }

    return blocks
        .map((block) => {
            const data = block?.data || {};
            switch (block?.type) {
                case "header":
                case "paragraph":
                case "quote":
                    return stripHtml(data.text || "");
                case "list":
                    return (data.items || []).map(stripHtml).filter(Boolean).join("\n");
                case "code":
                    return data.code || "";
                default:
                    return stripHtml(data.text || data.caption || "");
            }
        })
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 8000);
};

const llmConfig = () => {
    const apiKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
    const baseURL =
        process.env.LLM_BASE_URL ||
        (process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY && !process.env.LLM_API_KEY
            ? "https://api.openai.com/v1"
            : "https://api.groq.com/openai/v1");
    const model =
        process.env.LLM_MODEL ||
        (baseURL.includes("openai.com") ? "gpt-4o-mini" : "llama-3.3-70b-versatile");

    return { apiKey, baseURL, model };
};

export const llmReady = () => Boolean(llmConfig().apiKey);

export const remixModes = () =>
    Object.fromEntries(Object.entries(REMIX_MODES).map(([id, mode]) => [id, { id, label: mode.label }]));

export const completeChat = async ({ system, user, messages, maxTokens = 500, temperature = 0.85 }) => {
    const { apiKey, baseURL, model } = llmConfig();
    if (!apiKey) {
        const error = new Error("Muse is asleep. Add LLM_API_KEY (or GROQ_API_KEY) to the server .env");
        error.status = 503;
        throw error;
    }

    const chatMessages = messages?.length
        ? [{ role: "system", content: system }, ...messages]
        : [
            { role: "system", content: system },
            { role: "user", content: user }
        ];

    const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model,
            messages: chatMessages,
            temperature,
            max_tokens: maxTokens
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload?.error?.message || "The language model refused this remix");
        error.status = 502;
        throw error;
    }

    const text = payload?.choices?.[0]?.message?.content?.trim();
    if (!text) {
        const error = new Error("Muse returned a blank page");
        error.status = 502;
        throw error;
    }
    return text;
};

export const remixPost = async ({ mode, title, text, question, history }) => {
    if (mode === "ask") {
        const system = `You are the post itself, talking to a reader. Stay in first person as the piece. Only use what's in the article. If the article doesn't say, say so in one short line, then offer the closest thing it does say. Be vivid and brief (under 120 words unless they ask for more). Never invent citations.

Title: ${title}

Article:
${text}`;

        const messages = (history || [])
            .filter((item) => item?.role && item?.content)
            .slice(-6)
            .map((item) => ({
                role: item.role === "assistant" ? "assistant" : "user",
                content: String(item.content).slice(0, 800)
            }));

        if (question) {
            messages.push({ role: "user", content: String(question).slice(0, 500) });
        }

        if (!messages.length) {
            const error = new Error("Ask the post a question");
            error.status = 400;
            throw error;
        }

        return completeChat({ system, messages, maxTokens: 400, temperature: 0.7 });
    }

    const spec = REMIX_MODES[mode];
    if (!spec) {
        const error = new Error("Unknown remix");
        error.status = 400;
        throw error;
    }

    return completeChat({
        system: spec.system,
        user: `Title: ${title}\n\nArticle:\n${text}`,
        maxTokens: spec.maxTokens
    });
};

const parseJsonObject = (raw) => {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]);
    } catch {
        return null;
    }
};

export const museDraft = async ({ title, text, focus = "all" }) => {
    if (!text || text.length < 40) {
        const error = new Error("Write a little more, then Muse can help");
        error.status = 400;
        throw error;
    }

    const raw = await completeChat({
        temperature: 0.8,
        maxTokens: 400,
        system: `You help a blogger name and package a draft. Return JSON only, no markdown:
{"title":"","wild_title":"","des":"","tags":["",""]}
Rules:
- title: clear, human, under 80 chars. Prefer the author's title if it's already good; otherwise improve it.
- wild_title: a bolder, funner alternate. Still honest to the draft.
- des: 1-2 sentences, under 180 characters, no hashtags.
- tags: 3 lowercase topical tags, 1-2 words each, no #.
Focus on: ${focus}.`,
        user: `Current title: ${title || "(none yet)"}\n\nDraft:\n${text}`
    });

    const parsed = parseJsonObject(raw);
    if (!parsed) {
        const error = new Error("Muse got poetic instead of packing the draft. Try again.");
        error.status = 502;
        throw error;
    }

    const tags = Array.isArray(parsed.tags)
        ? parsed.tags.map((tag) => String(tag).toLowerCase().replace(/[#]/g, "").trim()).filter(Boolean).slice(0, 5)
        : [];

    return {
        title: String(parsed.title || "").slice(0, 100),
        wild_title: String(parsed.wild_title || "").slice(0, 100),
        des: String(parsed.des || "").slice(0, 200),
        tags
    };
};
