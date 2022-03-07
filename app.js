const { App, ExpressReceiver } = require('@slack/bolt');
const axios = require('axios');
const uuid = require('uuid');
const qr = require('qr-image');
const { ImgurClient } = require('imgur');
const dotenv = require('dotenv')

const db = require('./models/index.js')

dotenv.config()
console.log(process.env) 

const receiver = new ExpressReceiver({signingSecret: process.env.SLACK_SIGNING_SECRET});

// Initializes your app with your bot token and signing secret
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

async function generateInvoice(user, amount){

  const uniqueId = uuid.v4()

  let data = JSON.stringify({
    "correlationId": uniqueId,
    "description": "Slack Tip",
    "amount": {
      "currency": "USD",
      "amount": amount
    }
  });

  let config = {
    method: 'post',
    url: 'https://api.strike.me/v1/invoices/handle/' + user,
    headers: { 
      'Content-Type': 'application/json', 
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + process.env.STRIKE_API,
    },
    data : data
  };

  let r = axios(config)
    .then((response) => {
      let id = response.data.invoiceId;
      return id;
    })
    .catch((error) => {
      console.log(error);
    });

  return r;

}

async function generateLnInvoice(invoiceId){

  let config = {
    method: 'post',
    url: 'https://api.strike.me/v1/invoices/'+ invoiceId +'/quote',
    headers: { 
      'Accept': 'application/json', 
      'Content-Length': '0', 
      'Authorization': 'Bearer ' + process.env.STRIKE_API
    }
  };

  let r = axios(config)
    .then((response) => {
      return response.data.lnInvoice
    })
    .catch((error) => {
      console.log(error);
    });

  return r;
}

async function genarateQRCodeUrl(lnInvoice){

  let image = qr.imageSync(lnInvoice, { type: 'png' });

  const client = new ImgurClient({
    clientId: process.env.IMGUR_ID,
    clientSecret: process.env.IMGUR_SECRET,
  });

  const imageResponse = await client.upload({
    image: image,
    type: 'stream',
  });

  return imageResponse.data.link;
}


//
// A command is when you do /tip in any channel or private conversation
//
//

// It gives StrikeID given SlackID
// It sends the QR code in a private message
// It asks for strike handle to issue an invoice in their favor
// It tells a user somebody tip them


async function askForHandle(userId){

  console.log('---------------------------------')
  const users = await app.client.users.list()
  console.log(users)

  const conversation = await app.client.conversations.open({users: userId})

  const message = await app.client.chat.postMessage({
    channel: conversation.channel.id,
    text: "Hey! Somebody is sending you a tip. What's your Strike handle? I'll generate and invoice to your name and send it to them!"
  })
  console.log(conversation)
}

app.command('/tip', async ({ command, ack, respond }) => {
  // Acknowledge command request
  await ack();

  let invoiceId = await generateInvoice("ivan", "1.0");
  let lnInvoice = await generateLnInvoice(invoiceId);
  let imageUrl = await genarateQRCodeUrl(lnInvoice);

  askForHandle("U032UC1UH0B")

  await respond({
    blocks: [
      {
        "type": "image",
        "image_url": imageUrl,
        "alt_text": "QR code to pay"

      }

    ]
  })

});

app.shortcut('tip1', async ({ shortcut, ack, client, logger }) => {
  await ack();
  // Check if we have a user in database with strikeID
  // NO -> askForStrikeHandle
  // YES -> generate invoice
  //
  await theMostOpFunctionKnownToMan("1", shortcut, client);
});


app.shortcut('tip100', async ({ shortcut, ack, client, logger }) => {
  await ack();
  await theMostOpFunctionKnownToMan("100", shortcut, client);
});

app.shortcut('tip10', async ({ shortcut, ack, client, logger }) => {
  await ack();
  await theMostOpFunctionKnownToMan("10", shortcut, client);
});

async function theMostOpFunctionKnownToMan(amount, shortcut, client){

  const slackUserId = shortcut.message.user
  const trigger_id = shortcut.trigger_id

  console.log(shortcut);



  // given this slackUserID. Do I have a strike ID?
  // no -> Ask for it
  //
  const user = await db.User.findOne({where: {slackId: slackUserId }});
  if (user == null){
    await askForStrikeHandle(trigger_id, client, amount, shortcut, client);
  }else{
    await generateInvoiceForAmountAndSendMessage(amount, shortcut, client);
    //await somebodyTipYou(slackUserId, client);
  }
}

async function generateInvoiceForAmountAndSendMessage(amount, shortcut, client){

  let invoiceId = await generateInvoice("ivan", amount);
  let lnInvoice = await generateLnInvoice(invoiceId);
  let imageUrl = await genarateQRCodeUrl(lnInvoice);

  await sendInvoiceMessage(imageUrl, shortcut, client);
}

async function sendInvoiceMessage(imageUrl, shortcut, client){

  const slackId = shortcut.message.user
  const conversation = await client.conversations.open({users: slackId})
  await client.chat.postMessage({
    channel: conversation.channel.id,
    text: "⚡️ Invoice",
    blocks: [
      {
        "type": "image",
        "image_url": imageUrl,
        "alt_text": "QR code to pay"
      }
    ]

  })
}

async function askForStrikeHandle(trigger_id, client){
  console.log(client)
  console.log(trigger_id)
  try {
    // Call views.open with the built-in client
    await client.views.open({
      // Pass a valid trigger_id within 3 seconds of receiving it
      trigger_id: trigger_id,
      // View payload
      view: {
        type: 'modal',
        // View identifier
        callback_id: 'handlePrompt',
        title: {
          type: 'plain_text',
          text: 'I need some info'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Somebody is trying to send you money using Strike.'
            },
          },
          {
            dispatch_action: true,
            type: 'input',
            block_id: 'input_c',
            label: {
              type: 'plain_text',
              text: 'What is your strike handle?'
            },
            element: {
              type: 'plain_text_input',
              action_id: 'strikeHandle',
              multiline: true
            }
          }
        ],
        submit: {
          type: 'plain_text',
          text: 'Submit'
        }
      }
    });

  }
  catch (error) {
    console.error(error);
  }

}


async function somebodyTipYou(slackUserId, client){

  const conversation = await client.conversations.open({users: slackUserId })

  await client.chat.postMessage({
    channel: conversation.channel.id,
    text: "Somebody tip you"
  })

}


app.view('handlePrompt',  async ({ ack, body, view, client, logger}) => {

  await ack();

  //console.log("___________________");
  //console.log(body);
  //console.log("___________________");

  const slackId = body['user']['id'];
  const strikeId = view['state']['values']['input_c']['strikeHandle']['value'];


  db.User.findOrCreate({where: {slackId: slackId, strikeId: strikeId}})
})

app.event('app_home_opened', async ({ event, client, logger }) => {
  try {
    // Call views.publish with the built-in client
    const result = await client.views.publish({
      // Use the user ID associated with the event
      user_id: event.user,
      view: {
        // Home tabs must be enabled in your app configuration page under "App Home"
        "type": "home",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*Hello <@" + event.user + "> :crown:"
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "I'm a Slack bot that uses the Strike's API to money money."
            }
          }
        ]
      }
    });
  }
  catch (error) {
    logger.error(error);
  }
});

receiver.router.get('/', (req, res) => {
  // You're working with an express req and res now.
  res.send('So a fish is swimming in water, and you ask the fish, – “Where’s the water?” and the fish says “What water?');
});


(async () => {
  // Start your app
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
