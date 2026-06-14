require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://token-os.netlify.app';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, {});
  return sessions.get(chatId);
}

bot.start((ctx) => {
  ctx.replyWithMarkdown(
    `⚡ *TOKEN OS* — Command Center\n\n` +
    `*Commands:*\n` +
    `/project <mint> — Register or load a token\n` +
    `/holders — Live holder count\n` +
    `/top — Top 10 holders\n` +
    `/overview — Full token stats\n` +
    `/milestone <type> <value> — Set an alert\n` +
    `/airdrop <sol> — Preview airdrop\n` +
    `/dashboard — Open web dashboard`,
    Markup.inlineKeyboard([[Markup.button.url('🖥 Open Dashboard', DASHBOARD_URL)]])
  );
});

bot.command('project', async (ctx) => {
  const mint = ctx.message.text.split(' ')[1]?.trim();
  if (!mint) return ctx.reply('Usage: /project <mint_address>');
  const session = getSession(ctx.chat.id);
  const msg = await ctx.reply('🔍 Registering project...');
  try {
    const res = await axios.post(`${BACKEND}/api/projects/register`, {
      name: `Project ${mint.slice(0, 6)}`,
      mintAddress: mint,
      ownerWallet: ctx.from.id.toString()
    });
    session.project = res.data;
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `✅ *Project loaded!*\n\nMint: \`${mint.slice(0,8)}...${mint.slice(-4)}\``,
      { parse_mode: 'Markdown' });
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `❌ Failed: ${e.response?.data?.error || e.message}`);
  }
});

bot.command('overview', async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (!session.project) return ctx.reply('Set a project first: /project <mint>');
  const msg = await ctx.reply('📊 Fetching...');
  try {
    const res = await axios.get(`${BACKEND}/api/projects/${session.project.id}/overview`);
    const { metadata, price, holderCount, topHolders } = res.data;
    const priceStr = price ? `$${Number(price).toFixed(8)}` : 'N/A';
    const top3 = (topHolders || []).slice(0, 3).map((h, i) =>
      `${['🥇','🥈','🥉'][i]} \`${h.wallet.slice(0,6)}...${h.wallet.slice(-4)}\` — ${Number(h.uiAmount).toLocaleString()}`
    ).join('\n');
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `📈 *${metadata?.name} (${metadata?.symbol})*\n\n👥 Holders: *${Number(holderCount).toLocaleString()}*\n💵 Price: *${priceStr}*\n\n*Top Holders:*\n${top3}`,
      { parse_mode: 'Markdown' });
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `❌ Error: ${e.response?.data?.error || e.message}`);
  }
});

bot.command('holders', async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (!session.project) return ctx.reply('Set a project first: /project <mint>');
  const msg = await ctx.reply('⏳ Fetching from chain...');
  try {
    const res = await axios.get(`${BACKEND}/api/projects/${session.project.id}/holders`);
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `👥 *Live Holder Count*\n\n*${Number(res.data.totalHolders).toLocaleString()}* holders on-chain`,
      { parse_mode: 'Markdown' });
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `❌ Error: ${e.response?.data?.error || e.message}`);
  }
});

bot.command('top', async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (!session.project) return ctx.reply('Set a project first: /project <mint>');
  const msg = await ctx.reply('🔭 Fetching top holders...');
  try {
    const res = await axios.get(`${BACKEND}/api/projects/${session.project.id}/holders`);
    const rows = res.data.topHolders.slice(0, 10).map(h =>
      `*${h.rank}.* \`${h.wallet.slice(0,6)}...${h.wallet.slice(-4)}\` — ${Number(h.uiAmount).toLocaleString()}`
    ).join('\n');
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `🏆 *Top 10 Holders*\n\n${rows}`, { parse_mode: 'Markdown' });
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `❌ Error: ${e.response?.data?.error || e.message}`);
  }
});

bot.command('milestone', async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (!session.project) return ctx.reply('Set a project first: /project <mint>');
  const args = ctx.message.text.split(' ').slice(1);
  const type = args[0];
  const value = parseFloat(args[1]);
  if (!type || isNaN(value)) {
    return ctx.replyWithMarkdown('Usage: /milestone <type> <value>\n\nTypes: `holder_count` or `price`');
  }
  try {
    await axios.post(`${BACKEND}/api/projects/${session.project.id}/milestones`, {
      type, targetValue: value
    });
    ctx.replyWithMarkdown(`✅ *Milestone set!*\n\nWatching: \`${type}\` ≥ \`${value.toLocaleString()}\``);
  } catch (e) {
    ctx.reply(`❌ Error: ${e.response?.data?.error || e.message}`);
  }
});

bot.command('airdrop', async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (!session.project) return ctx.reply('Set a project first: /project <mint>');
  const args = ctx.message.text.split(' ').slice(1);
  const amount = parseFloat(args[0]);
  if (!amount) return ctx.reply('Usage: /airdrop <sol_amount>');
  const msg = await ctx.reply('💸 Calculating...');
  try {
    const res = await axios.post(`${BACKEND}/api/airdrops/${session.project.id}/preview`, {
      totalAmount: amount
    });
    const d = res.data;
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `💸 *Airdrop Preview*\n\nRecipients: *${d.recipientCount.toLocaleString()}*\nTotal: *${d.totalAmount.toFixed(4)} SOL*\nFee (1%): *${d.feeAmount.toFixed(4)} SOL*\nNet: *${d.netAmount.toFixed(4)} SOL*\nPer wallet: *${d.perWallet.toFixed(6)} SOL*`,
      { parse_mode: 'Markdown' });
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `❌ Error: ${e.response?.data?.error || e.message}`);
  }
});

bot.command('dashboard', (ctx) => {
  ctx.reply('🖥 Open your Token OS dashboard:',
    Markup.inlineKeyboard([[Markup.button.url('Open Dashboard', DASHBOARD_URL)]]));
});

bot.catch((err, ctx) => {
  console.error(`[bot] Error:`, err);
  ctx.reply('⚠️ Something went wrong.').catch(() => {});
});

bot.launch().then(() => console.log('TOKEN OS bot running'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
