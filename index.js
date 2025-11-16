const admin = require("firebase-admin");
const { Client, GatewayIntentBits } = require("discord.js");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const pendingCategoryCreate = new Map();

// -----------------------------
// Initialize Firebase via ENV
// -----------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  }),
});

const db = admin.firestore();

// -----------------------------
// Single message listener
// -----------------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();

  // -----------------------------
  // Test Firebase
  // -----------------------------
  if (content === "!testfirebase") {
    await db.collection("test").doc("ping").set({ msg: "Hello from Discord bot!" });
    return msg.reply("✅ Written to Firestore successfully!");
  }

  // -----------------------------
  // Help Command
  // -----------------------------
  if (content === "!help") {
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

  // -----------------------------
  // Link Command
  // -----------------------------
  if (content === "!link") {
    return msg.reply(
`**📘 Link to website**
-------------------------------------
https://vocab-cards-eight.vercel.app/
-------------------------------------`
    );
  }

  // -----------------------------
  // Handle pending category creation
  // -----------------------------
  const pending = pendingCategoryCreate.get(msg.author.id);
  if (pending) {
    const reply = content.toLowerCase();
    if (reply === "no") {
      pendingCategoryCreate.delete(msg.author.id);
      return msg.reply("❌ Cancelled.");
    }
    if (reply === "yes") {
      await db.collection("vocab").doc(pending.category).set({
        createdAt: Date.now(),
        totalVocab: 0,
      });
      msg.reply(`✅ Category **${pending.category}** created! Adding vocab now...`);
      await addVocabToCategory(msg, pending.category, pending.vocabPairs);
      pendingCategoryCreate.delete(msg.author.id);
      return;
    }
    return;
  }

  // -----------------------------
  // ADD VOCAB
  // -----------------------------
  if (content.startsWith("!add vocab")) {
    const parts = content.split(/\s+/);
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
  }

  // -----------------------------
  // DELETE VOCAB
  // -----------------------------
  if (content.startsWith("!delete vocab")) {
    const parts = content.split(/\s+/);
    if (parts.length < 4) return msg.reply("❌ Use: `!delete vocab <category> <vocab>`");

    const category = parts[2];
    const vocab = parts[3];
    const ref = db.collection("vocab").doc(category).collection("vocab");
    const snapshot = await ref.where("vocab", "==", vocab).get();
    if (snapshot.empty) return msg.reply(`❌ Vocab **${vocab}** not found in category **${category}**.`);

    snapshot.forEach((d) => d.ref.delete());
    return msg.reply(`🗑️ Deleted vocab **${vocab}** from category **${category}**.`);
  }

  // -----------------------------
  // DELETE CATEGORY
  // -----------------------------
  if (content.startsWith("!delete category")) {
    const parts = content.split(/\s+/);
    if (parts.length < 3) return msg.reply("❌ Use: `!delete category <category>`");

    const category = parts[2];
    const catRef = db.collection("vocab").doc(category);
    const catDoc = await catRef.get();
    if (!catDoc.exists) return msg.reply(`❌ Category **${category}** does not exist.`);

    const vocabSnap = await catRef.collection("vocab").get();
    vocabSnap.forEach((d) => d.ref.delete());
    await catRef.delete();
    return msg.reply(`🗑️ Category **${category}** and all its vocabulary deleted.`);
  }

  // -----------------------------
  // LIST CATEGORIES
  // -----------------------------
  if (content === "!list categories") {
    const snapshot = await db.collection("vocab").get();
    if (snapshot.empty) return msg.reply("⚠️ No categories found.");
    const categories = snapshot.docs.map((doc) => doc.id).join(", ");
    return msg.reply(`📚 Categories:\n${categories}`);
  }

  // -----------------------------
  // LIST VOCAB IN CATEGORY
  // -----------------------------
  if (content.startsWith("!list vocab")) {
    const parts = content.split(/\s+/);
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
    return msg.reply(response);
  }

  // -----------------------------
  // EDIT VOCAB
  // -----------------------------
  if (content.startsWith("!edit vocab")) {
    const parts = content.split(/\s+/);
    if (parts.length < 5) return msg.reply("❌ Use: `!edit vocab <category> <word> <newMeaning>`");

    const category = parts[2];
    const vocab = parts[3];
    const newMeaning = parts.slice(4).join(" "); // supports multi-word meaning

    const ref = db.collection("vocab").doc(category).collection("vocab");
    const snapshot = await ref.where("vocab", "==", vocab).get();
    if (snapshot.empty) return msg.reply(`❌ Vocab **${vocab}** not found in category **${category}**.`);

    snapshot.forEach((d) => d.ref.update({ meaning: newMeaning }));
    return msg.reply(`✏️ Updated **${vocab}** in **${category}** → ${newMeaning}`);
  }
});

// -----------------------------
// Add vocab helper function
// -----------------------------
async function addVocabToCategory(msg, category, vocabPairs) {
  const ref = db.collection("vocab").doc(category).collection("vocab");
  let success = 0, fail = 0;

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

client.login(process.env.DISCORD_TOKEN);
