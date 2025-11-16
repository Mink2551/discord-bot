const admin = require("firebase-admin");
const { Client, GatewayIntentBits } = require("discord.js");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

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

// store temp category creation session
const pendingCategoryCreate = new Map();

// store active vocab "play" sessions
const activeGames = new Map();


// -----------------------------------------------------
// BUTTON HANDLER FOR GAME
// -----------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;
  const session = activeGames.get(userId);
  if (!session)
    return interaction.reply({
      content: "❌ No game running.",
      ephemeral: true,
    });

  const id = interaction.customId;

  if (id === "learning") session.stats.learning++;
  if (id === "remember") session.stats.remember++;
  if (id === "meaning") session.stats.meaning++;

  session.index++;

  if (session.index >= session.vocabList.length) {
    activeGames.delete(userId);

    return interaction.update({
      content:
`🏁 **Game Finished!**
📘 **Category:** ${session.vocabList[0].category || "Unknown"}

**Analysis**
--------------------------------
🔵 Still Learning: **${session.stats.learning}**
🟢 Remember: **${session.stats.remember}**
🟡 Show Meaning: **${session.stats.meaning}**
--------------------------------
Total words: **${session.vocabList.length}**`,
      components: [],
    });
  }

  return sendGameCard(interaction, session, true);
});


// -----------------------------------------------------
// SEND GAME CARD FUNCTION
// -----------------------------------------------------
async function sendGameCard(target, session, edit = false) {
  const item = session.vocabList[session.index];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("learning")
      .setLabel("Still Learning")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("remember")
      .setLabel("Remember")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("meaning")
      .setLabel("Show Meaning")
      .setStyle(ButtonStyle.Primary)
  );

  const content =
`📘 **Word ${session.index + 1}/${session.vocabList.length}**
-------------------------------------
**${item.vocab}**
(What is the meaning?)
-------------------------------------`;

  if (edit) return target.update({ content, components: [row] });
  return target.reply({ content, components: [row] });
}


// -----------------------------------------------------
// SHUFFLE
// -----------------------------------------------------
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}


// -----------------------------------------------------
// MESSAGE COMMAND HANDLER
// -----------------------------------------------------
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
  // Help
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

**List categories**
\`!list categories\`

**List all vocab in category**
\`!list vocab <category>\`

**Edit vocab**
\`!edit vocab <category> <word> <newMeaning>\`

**Play game**
\`!play <category>\`

**Show web link**
\`!link\`
-------------------------------------`
    );
  }


  // -----------------------------
  // Link to website
  // -----------------------------
  if (content === "!link") {
    return msg.reply(`https://vocab-cards-eight.vercel.app/`);
  }


  // -----------------------------
  // Handle pending YES/NO for category creation
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
    if (parts.length < 4)
      return msg.reply("❌ Use: `!add vocab <category> <vocab:meaning>`");

    const category = parts[2];
    const vocabPairs = parts.slice(3);

    const categoryRef = db.collection("vocab").doc(category);
    const categoryDoc = await categoryRef.get();

    if (!categoryDoc.exists) {
      pendingCategoryCreate.set(msg.author.id, { category, vocabPairs });
      return msg.reply(
        `⚠️ Category **${category}** does not exist.\nType **yes** to create or **no** to cancel.`
      );
    }

    return addVocabToCategory(msg, category, vocabPairs);
  }


  // -----------------------------
  // DELETE VOCAB
  // -----------------------------
  if (content.startsWith("!delete vocab")) {
    const parts = content.split(/\s+/);
    if (parts.length < 4)
      return msg.reply("❌ Use: `!delete vocab <category> <word>`");

    const category = parts[2];
    const vocab = parts[3];

    const ref = db.collection("vocab").doc(category).collection("vocab");
    const snapshot = await ref.where("vocab", "==", vocab).get();

    if (snapshot.empty)
      return msg.reply(`❌ Vocab **${vocab}** not found in **${category}**.`);

    snapshot.forEach((d) => d.ref.delete());
    return msg.reply(`🗑️ Deleted **${vocab}** from **${category}**.`);
  }


  // -----------------------------
  // DELETE CATEGORY
  // -----------------------------
  if (content.startsWith("!delete category")) {
    const parts = content.split(/\s+/);
    if (parts.length < 3)
      return msg.reply("❌ Use: `!delete category <category>`");

    const category = parts[2];
    const catRef = db.collection("vocab").doc(category);
    const catDoc = await catRef.get();

    if (!catDoc.exists)
      return msg.reply(`❌ Category **${category}** does not exist.`);

    const vocabSnap = await catRef.collection("vocab").get();
    vocabSnap.forEach((d) => d.ref.delete());
    await catRef.delete();

    return msg.reply(`🗑️ Category **${category}** deleted.`);
  }


  // -----------------------------
  // LIST CATEGORIES
  // -----------------------------
  if (content === "!list categories") {
    const snapshot = await db.collection("vocab").get();

    if (snapshot.empty)
      return msg.reply("⚠️ No categories found.");

    const categories = snapshot.docs.map((doc) => doc.id).join(", ");
    return msg.reply(`📚 Categories:\n${categories}`);
  }


  // -----------------------------
  // LIST VOCAB
  // -----------------------------
  if (content.startsWith("!list vocab")) {
    const parts = content.split(/\s+/);
    if (parts.length < 3)
      return msg.reply("❌ Use: `!list vocab <category>`");

    const category = parts[2];

    const ref = db.collection("vocab").doc(category).collection("vocab");
    const snapshot = await ref.get();

    if (snapshot.empty)
      return msg.reply(`⚠️ No vocab in **${category}**.`);

    let out = `📘 Vocabulary in **${category}**:\n`;
    snapshot.forEach((doc) => {
      const d = doc.data();
      out += `• ${d.vocab} → ${d.meaning}\n`;
    });

    return msg.reply(out);
  }


  // -----------------------------
  // EDIT VOCAB
  // -----------------------------
  if (content.startsWith("!edit vocab")) {
    const parts = content.split(/\s+/);
    if (parts.length < 5)
      return msg.reply("❌ Use: `!edit vocab <category> <word> <newMeaning>`");

    const category = parts[2];
    const vocab = parts[3];
    const newMeaning = parts.slice(4).join(" ");

    const ref = db.collection("vocab").doc(category).collection("vocab");
    const snapshot = await ref.where("vocab", "==", vocab).get();

    if (snapshot.empty)
      return msg.reply(`❌ Vocab **${vocab}** not found.`);

    snapshot.forEach((d) => d.ref.update({ meaning: newMeaning }));
    return msg.reply(`✏️ Updated **${vocab}** → ${newMeaning}`);
  }


  // -----------------------------
  // PLAY GAME
  // -----------------------------
  if (content.startsWith("!play")) {
    const parts = content.split(/\s+/);
    if (parts.length < 2)
      return msg.reply("❌ Use: `!play <category>`");

    const category = parts[1];

    const ref = db.collection("vocab").doc(category).collection("vocab");
    const snapshot = await ref.get();

    if (snapshot.empty)
      return msg.reply(`⚠️ No vocab found in **${category}**.`);

    const vocabList = snapshot.docs.map((d) => d.data());
    shuffleArray(vocabList);

    const session = {
      index: 0,
      vocabList,
      stats: { learning: 0, remember: 0, meaning: 0 },
      userId: msg.author.id,
    };

    activeGames.set(msg.author.id, session);

    return sendGameCard(msg, session);
  }

});


// -----------------------------------------------------
// VOCAB ADD HELPER
// -----------------------------------------------------
async function addVocabToCategory(msg, category, vocabPairs) {
  const ref = db.collection("vocab").doc(category).collection("vocab");

  let success = 0;
  let fail = 0;

  for (const pair of vocabPairs) {
    const [word, meaning] = pair.split(":");
    if (!word || !meaning) {
      fail++;
      continue;
    }

    await ref.add({
      vocab: word,
      meaning: meaning,
      timestamp: Date.now(),
      category,
    });

    success++;
  }

  return msg.reply(
    `📘 **Category:** ${category}\n➕ Added: **${success}**\n❌ Failed: **${fail}**`
  );
}


// -----------------------------------------------------
client.login(process.env.DISCORD_TOKEN);
