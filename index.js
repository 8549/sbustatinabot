'use strict';

const { Telegraf } = require('telegraf');
const Extra = require('telegraf/extra');
const Markup = require('telegraf/markup');
const commandParts = require('telegraf-command-parts');

const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');

const db = new Firestore();
const storage  = new Storage();
const bot = new Telegraf(process.env.TELEGRAM_TOKEN, { telegram: { webhookReply: true } });

const handleScambia = async function(ctx) {
  return ctx.reply('⚙️ Presto fuori... 🛠️', Extra.inReplyTo(ctx.message.message_id));
}

const handleSbusta = async function(ctx) {
  // User lookup: if not present in db, add user id to db 
  const userRef = db.collection('users').doc(String(ctx.from.id));
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists) {
    const userInfo = {};
    if (ctx.from.username) {
      userInfo.username = ctx.from.username;
    }
    if (ctx.from.first_name) {
      userInfo.first_name = ctx.from.first_name;
    }
    if (ctx.from.last_name) {
      userInfo.last_name = ctx.from.last_name;
    }
    userRef.create(userInfo);
  }

  const sbustateRef = userRef.collection('sbustate');
  const sbustate = await sbustateRef.listDocuments();
  if (sbustate.length < process.env.DAILY_SBUSTATE) {
    ctx.webhookReply = false;
    await ctx.replyWithChatAction('upload_photo');
    ctx.webhookReply = true;
    sbustateRef.add({ timestamp: new Date() });

    const chosenSet = process.env.DEFAULT_SET; /* Let users choose the set */
    const cardsRef = db.collection('sets').doc(chosenSet).collection('cards');
    const cardsSnapshots = await cardsRef.get();
    const cards = [];
    cardsSnapshots.forEach(snapshot => {
      cards.push(snapshot.data());
    });
    cards.sort((a, b) => a.id - b.id);
    const chosenCard = chooseWeighted(cards);
  
    // const caption = `Hai sbustato ${chosenCard.name} (${chosenCard.id}/${totalCards}, ${setName})! (Sbustata di debug)`;
    const [url] = await storage
      .bucket(process.env.BUCKET)
      .file(`${chosenSet}/${chosenCard.image}`)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 1 * 60 * 1000, // 1 minute
      });

    // Add card to collection
    const [cardInSet] = (await cardsRef.where('id', '==', chosenCard.id).limit(1).get()).docs; /* Might return multiple cards! e.g. Multiple secret rare cards with same number */
    const cardInCollectionRef = userRef.collection('collection').doc(cardInSet.id);
    const cardInCollectionSnapshot = await cardInCollectionRef.get();
    if (!cardInCollectionSnapshot.exists) {
      cardInCollectionRef.create({ card: cardInSet.ref, count: 1 });
    }
    else {
      const currentCount = cardInCollectionSnapshot.data().count;
      cardInCollectionRef.update({ count: currentCount + 1 });
    }  
    return ctx.replyWithPhoto({ url: url }, Extra.inReplyTo(ctx.message.message_id)/*.caption(caption)*/);
  }
  else {
    return ctx.reply('Hai esaurito le sbustate disponibili per oggi... 😔', Extra.inReplyTo(ctx.message.message_id));
  }
}

const handleCollezione = async function(ctx) {
  ctx.webhookReply = false;
  await ctx.replyWithChatAction('typing');
  ctx.webhookReply = true;

  const cardsInCollection = [];
  const collectionRef = await db.collection('users').doc(String(ctx.from.id)).collection('collection').listDocuments();
  if (collectionRef.length === 0) {
    return ctx.reply(`La tua collezione è ancora vuota 🧐`);
  }

  for (let i = 0; i < collectionRef.length; i++) {
    const currentCard = (await collectionRef[i].get()).data();
    const cardRef = currentCard.card;
    const set = (await cardRef.parent.parent.get()).data();
    const cardData = (await cardRef.get()).data();
    cardsInCollection.push({
      ...cardData,
      count: currentCard.count,
      set: set.fullName,
      numberOfCards: set.numberOfCards
    });
  }
  cardsInCollection.sort((a, b) => a.id - b.id);

  // When multiple set: group by set https://stackoverflow.com/a/38327540/1950961
  const collectionStrings = cardsInCollection.map(card => `${card.id}/${card.numberOfCards} (${card.set}) ${card.name} x${card.count}`);
  const message = `📒 La tua collezione:\n\n${collectionStrings.join('\n')}`;
  return ctx.reply(message, Extra.inReplyTo(ctx.message.message_id));
}

const handleValuta = async function(ctx) {
  if (ctx.state.command.args === '') {
    return ctx.reply('❗ Errore: Non mi hai detto quale set vuoi valutare', Extra.inReplyTo(ctx.message.message_id));
  }
  const collectionRef = await db.collection('users').doc(String(ctx.from.id)).collection('collection').listDocuments();
  const querySnapshot = await db.collection('sets').where('fullName', '==', ctx.state.command.args).limit(1).get();
  if (querySnapshot.empty) {
    return ctx.reply('❗ Errore: Nessun set con quel nome', Extra.inReplyTo(ctx.message.message_id));
  }
  const [set] = querySnapshot.docs;
  const completedSetFraction = collectionRef.length / set.numberOfCards;
  let comment;
  if (completedSetFraction === 0) {
    comment = '😅 Non c\'è ancora niente';
  }
  else if (0 < completedSetFraction <= 0.3) {
    comment = '🥴 È un buon inizio...';
  }
  else if (0.3 < completedSetFraction <= 0.45) {
    comment = '👀 Un bel gruzzoletto';
  }
  else if (0.45 < completedSetFraction <= 0.55) {
    comment = '🤩 Un mezzo devasto!';
  }
  else if (0.55 < completedSetFraction <= 0.7) {
    comment = '💪 Sei a metà strada, campione';
  }
  else if (0.7 < completedSetFraction <= 0.95) {
    comment = '🤑 Pooooorco zio';
  }
  else if (0.95 < completedSetFraction < 1) {
    comment = '😳 Un bel devastino...';
  }
  else if (completedSetFraction === 1) {
    comment = '💯 Devasto puro';
  }
  else {
    comment = 'Non so come valutare la tua collezione...';
  }
  return ctx.reply(comment, Extra.inReplyTo(ctx.message.message_id));
}

const handleCocozza = async function(ctx) {
  ctx.webhookReply = false;
  await ctx.replyWithChatAction('upload_photo');
  ctx.webhookReply = true;
  const [url] = await storage
      .bucket(process.env.BUCKET)
      .file(`cocozza.png`)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 5 * 60 * 1000, // 1 minute
      });
  return ctx.replyWithPhoto({ url: url }, Extra.inReplyTo(ctx.message.message_id).caption('Cocozza'));
}

const preCheck = async function(ctx, next) {
  if (ctx.message.text) {
    const me = await bot.telegram.getMe();
    const isPrivateChat = ctx.chat.type === 'private';
    const admins = (!isPrivateChat) ? await ctx.getChatAdministrators(ctx.chat.id) : [];
    const isPrivacyModeDisabled = me.can_read_all_group_messages;
    if (isPrivacyModeDisabled && !isPrivateChat) {
      ctx.webhookReply = false;
      await ctx.reply('❗ Errore: Il privacy mode non è abilitato.', Extra.inReplyTo(ctx.message.message_id));
      ctx.webhookReply = true;
      return ctx.leaveChat();
    }
    else if (admins.includes(me.username)) {
      ctx.webhookReply = false;
      await ctx.reply('❗ Errore: Per favore, riaggiungimi senza rendermi amministratore del gruppo.', Extra.inReplyTo(ctx.message.message_id));
      ctx.webhookReply = true;
      return ctx.leaveChat();
    }
    else {
      return next();
    }
  }
}


bot.telegram.getMe().then((botInfo) => {
  bot.options.username = botInfo.username;
});

bot.use(commandParts());
// bot.use((ctx, next) => preCheck(ctx, next));
bot.start((ctx) => ctx.reply(`🍬 @Sbustatina_bot v${process.env.MAJOR_VERSION}.${process.env.K_REVISION}: attivato 🍬`));
bot.command('cocozza', (ctx) => handleCocozza(ctx));
bot.command('sbusta', (ctx) => handleSbusta(ctx));
bot.command('scambia', (ctx) => handleScambia(ctx));
bot.command('collezione', (ctx) => handleCollezione(ctx));
bot.command('valuta', (ctx) => handleValuta(ctx));
bot.on('message', (ctx, next) => ctx.reply('Non so come rispondere', Extra.inReplyTo(ctx.message.message_id)));
bot.catch((err, ctx) => {
  console.error(err);
  return ctx.reply('❗ Errore 500: Si è verificato un errore interno.');
});

exports.start = async (req, res) => {
  return bot.handleUpdate(req.body, res);
}

function chooseWeighted(cards) {
  const weights = cards.map(card => card.weight);
  const weightsSum = weights.reduce((acc, el) => acc += el);

  let random = Math.floor(Math.random() * weightsSum);

  for (let i = 0; i < cards.length; i++) {
    random -= weights[i];
    if (random < 0) {
       return cards[i];
    }
  }
}

function createMention(sender) {
  if (sender.username) {
    return `@${sender.username}`
  }
  else if (sender.first_name) {
    const lastName = (sender.last_name) ? ` ${sender.last_name}` : '';
    return `[${sender.first_name}${lastName}](tg://user?id=${sender.id})`
  }
}