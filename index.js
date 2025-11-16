const admin = require("firebase-admin");
const { Client, GatewayIntentBits } = require("discord.js");
require("dotenv").config();

// initialize Firebase with your service key
admin.initializeApp({
  credential: admin.credential.cert(require("./firebase-key.json")),
});

const db = admin.firestore(); // Firestore database
const pendingCategoryCreate = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on("ready", () => {
  console.log(`Bot is online as ${client.user.tag}`);
});

// -----------------------------
// HELP COMMAND
// -----------------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.content === "!testfirebase") {
    await db.collection("test").doc("ping").set({ msg: "Hello from Discord bot!" });
    msg.reply("✅ Written to Firestore successfully!");
  }
  
  if (msg.content === "!help") {
    return msg.reply(
`**📘 VocabBot Commands**
-------------------------------------
**Add vocab**
\`!add vocab <category> <word:meaning...>\`

**Delete vocab**
\`!delete vocab <category> <word>\`

**Delete whole category**
\`!delete category <category>\`

**List all categories**
\`!list categories\`

**List all vocab in category**
\`!list vocab <category>\`

**Edit vocab meaning**
\`!edit vocab <category> <word> <newMeaning>\`

**Show help**
\`!help\`

**Show link**
\`!link\`
-------------------------------------`
    );
  }
});

// -----------------------------
// ADD VOCAB COMMAND
// -----------------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!add vocab")) return;

  const parts = msg.content.trim().split(/\s+/);
  if (parts.length < 4) return msg.reply("❌ Use: `!add vocab <category> <vocab:meaning>`");

  const category = parts[2];
  const vocabPairs = parts.slice(3);

  const categoryRef = db.collection("vocab").doc(category);
  const categoryDoc = await categoryRef.get();

  if (!categoryDoc.exists) {
    pendingCategoryCreate.set(msg.author.id, { category, vocabPairs });
    return msg.reply(
      `⚠️ Category **${category}** does not exist.\nDo you want to create it? Type: **yes** or **no**`
    );
  }

  return addVocabToCategory(msg, category, vocabPairs);
});

// -----------------------------
// Link COMMAND
// -----------------------------

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.content === "!testfirebase") {
    await db.collection("test").doc("ping").set({ msg: "Hello from Discord bot!" });
    msg.reply("✅ Written to Firestore successfully!");
  }
  
  if (msg.content === "!link") {
    return msg.reply(
`**📘 Link to website**
-------------------------------------
https://vocab-cards-eight.vercel.app/
-------------------------------------`
    );
  }
});


// -----------------------------
// HANDLE YES/NO CONFIRMATION
// -----------------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  const pending = pendingCategoryCreate.get(msg.author.id);
  if (!pending) return;

  const reply = msg.content.toLowerCase();
  if (reply === "no") {
    pendingCategoryCreate.delete(msg.author.id);
    return msg.reply("❌ Cancelled.");
  }
  if (reply !== "yes") return;

  await db.collection("vocab").doc(pending.category).set({
    createdAt: Date.now(),
    totalVocab: 0,
  });

  msg.reply(`✅ Category **${pending.category}** created! Adding vocab now...`);
  await addVocabToCategory(msg, pending.category, pending.vocabPairs);
  pendingCategoryCreate.delete(msg.author.id);
});

// -----------------------------
// SAVE VOCAB FUNCTION
// -----------------------------
async function addVocabToCategory(msg, category, vocabPairs) {
  const ref = db.collection("vocab").doc(category).collection("vocab");
  let success = 0;
  let fail = 0;

  for (const pair of vocabPairs) {
    const [word, meaning] = pair.split(":");
    if (!word || !meaning) { fail++; continue; }

    await ref.add({
      vocab: word,
      meaning: meaning,
      timestamp: Date.now(),
    });

    success++;
  }

  return msg.reply(
    `📘 **Category:** ${category}\n➕ Success: **${success}**\n❌ Failed: **${fail}**`
  );
}

// -----------------------------
// DELETE VOCAB
// -----------------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!delete vocab")) return;

  const parts = msg.content.trim().split(/\s+/);
  if (parts.length < 4) return msg.reply("❌ Use: `!delete vocab <category> <vocab>`");

  const category = parts[2];
  const vocab = parts[3];

  const ref = db.collection("vocab").doc(category).collection("vocab");
  const snapshot = await ref.where("vocab", "==", vocab).get();

  if (snapshot.empty) return msg.reply(`❌ Vocab **${vocab}** not found in category **${category}**.`);

  snapshot.forEach((d) => d.ref.delete());
  msg.reply(`🗑️ Deleted vocab **${vocab}** from category **${category}**.`);
});

// -----------------------------
// DELETE WHOLE CATEGORY
// -----------------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!delete category")) return;

  const parts = msg.content.trim().split(/\s+/);
  if (parts.length < 3) return msg.reply("❌ Use: `!delete category <category>`");

  const category = parts[2];
  const catRef = db.collection("vocab").doc(category);
  const catDoc = await catRef.get();

  if (!catDoc.exists) return msg.reply(`❌ Category **${category}** does not exist.`);

  const vocabSnap = await catRef.collection("vocab").get();
  vocabSnap.forEach((d) => d.ref.delete());

  await catRef.delete();
  msg.reply(`🗑️ Category **${category}** and all its vocabulary deleted.`);
});

// -----------------------------
// LIST CATEGORIES
// -----------------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.content === "!list categories") {
    const snapshot = await db.collection("vocab").get();
    if (snapshot.empty) return msg.reply("⚠️ No categories found.");

    let categories = snapshot.docs.map((doc) => doc.id).join(", ");
    return msg.reply(`📚 Categories:\n${categories}`);
  }
});

// -----------------------------
// LIST VOCAB IN CATEGORY
// -----------------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!list vocab")) return;

  const parts = msg.content.trim().split(/\s+/);
  if (parts.length < 3) return msg.reply("❌ Use: `!list vocab <category>`");

  const category = parts[2];
  const ref = db.collection("vocab").doc(category).collection("vocab");
  const snapshot = await ref.get();

  if (snapshot.empty) return msg.reply(`⚠️ No vocab found in category **${category}**.`);

  let response = `📘 Vocabulary in **${category}**:\n`;
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    response += `• ${data.vocab} → ${data.meaning}\n`;
  });

  msg.reply(response);
});

// -----------------------------
// EDIT VOCAB
// -----------------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!edit vocab")) return;

  const parts = msg.content.trim().split(/\s+/);
  if (parts.length < 5) return msg.reply("❌ Use: `!edit vocab <category> <word> <newMeaning>`");

  const category = parts[2];
  const vocab = parts[3];
  const newMeaning = parts.slice(4).join(" "); // supports multiple words

  const ref = db.collection("vocab").doc(category).collection("vocab");
  const snapshot = await ref.where("vocab", "==", vocab).get();

  if (snapshot.empty) return msg.reply(`❌ Vocab **${vocab}** not found in category **${category}**.`);

  snapshot.forEach((d) => d.ref.update({ meaning: newMeaning }));
  msg.reply(`✏️ Updated **${vocab}** in **${category}** → ${newMeaning}`);
});

client.login(process.env.DISCORD_TOKEN);
