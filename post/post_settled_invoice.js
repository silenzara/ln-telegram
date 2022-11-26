const asyncAuto = require('async/auto');
const asyncDetect = require('async/detect');
const asyncMap = require('async/map');
const {balancedOpenRequest} = require('paid-services');
const {getChannel} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {subscribeToPastPayment} = require('ln-service');

const getBalancedOpenMessage = require('./get_balanced_open_message');
const getRebalanceMessage = require('./get_rebalance_message');
const getReceivedMessage = require('./get_received_message');
const {icons} = require('./../interface');

const escape = text => text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\\$&');
const {isArray} = Array;
const minQuizLength = 2;
const maxQuizLength = 10;
const randomIndex = n => Math.floor(Math.random() * n);
const sendOptions = {parse_mode: 'MarkdownV2'};
const uniq = arr => Array.from(new Set(arr));

/** Post settled invoices

  {
    from: <Invoice From Node String>
    id: <Connected User Id Number>
    invoice: {
      description: <Invoice Description String>
      id: <Invoice Preimage Hash Hex String>
      is_confirmed: <Invoice is Settled Bool>
      payments: [{
        [confirmed_at]: <Payment Settled At ISO 8601 Date String>
        created_at: <Payment Held Since ISO 860 Date String>
        created_height: <Payment Held Since Block Height Number>
        in_channel: <Incoming Payment Through Channel Id String>
        is_canceled: <Payment is Canceled Bool>
        is_confirmed: <Payment is Confirmed Bool>
        is_held: <Payment is Held Bool>
        messages: [{
          type: <Message Type Number String>
          value: <Raw Value Hex String>
        }]
        mtokens: <Incoming Payment Millitokens String>
        [pending_index]: <Pending Payment Channel HTLC Index Number>
        tokens: <Payment Tokens Number>
        [total_mtokens]: <Total Payment Millitokens String>
      }]
      received: <Received Tokens Number>
    }
    key: <Node Public Key Id Hex String>
    lnd: <Authenticated LND API Object>
    nodes: [{
      from: <From Node String>
      lnd: <Authenticated LND API Object>
      public_key: <Node Identity Public Key Hex String>
    }]
    quiz: ({answers: [<String>], correct: <Number>, question: <String>}) => {}
    send: <Send Message Function> (id, message, options) => {}
  }

  @returns via cbk or Promise
*/
module.exports = ({from, id, invoice, key, lnd, nodes, quiz, send}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!from) {
          return cbk([400, 'ExpectedFromNameToPostSettledInvoice']);
        }

        if (!id) {
          return cbk([400, 'ExpectedUserIdNumberToPostSettledInvoice']);
        }

        if (!invoice) {
          return cbk([400, 'ExpectedInvoiceToPostSettledInvoice']);
        }

        if (!key) {
          return cbk([400, 'ExpectedNodeIdentityKeyToPostSettledInvoice']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndObjectToPostSettledInvoice']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedArrayOfNodesToPostSettledInvoice']);
        }

        if (!quiz) {
          return cbk([400, 'ExpectedSendQuizFunctionToPostSettledInvoice']);
        }

        if (!send) {
          return cbk([400, 'ExpectedSendFunctionToPostSettledInvoice']);
        }

        return cbk();
      },

      // Parse balanced open request details if present
      balancedOpen: ['validate', ({}, cbk) => {
        // A proposal will be a push payment
        if (!invoice.is_confirmed) {
          return cbk();
        }

        const {proposal} = balancedOpenRequest({
          confirmed_at: invoice.confirmed_at,
          is_push: invoice.is_push,
          payments: invoice.payments,
          received_mtokens: invoice.received_mtokens,
        });

        return cbk(null, proposal);
      }],

      // Get the node aliases that forwarded this
      getNodes: ['validate', ({}, cbk) => {
        const inChannels = uniq(invoice.payments.map(n => n.in_channel));

        return asyncMap(inChannels, (id, cbk) => {
          return getChannel({id, lnd}, (err, res) => {
            if (!!err) {
              return cbk(null, {id, alias: id});
            }

            const peer = res.policies.find(n => n.public_key !== key);

            return getNodeAlias({lnd, id: peer.public_key}, cbk);
          });
        },
        cbk);
      }],

      // Find associated payment
      getPayment: ['validate', ({}, cbk) => {
        // Exit early when the invoice has yet to be confirmed
        if (!invoice.is_confirmed) {
          return cbk();
        }

        const sub = subscribeToPastPayment({lnd, id: invoice.id});

        sub.once('confirmed', payment => cbk(null, {payment}));
        sub.once('error', () => cbk());
        sub.once('failed', () => cbk());

        return;
      }],

      // Find associated transfer
      getTransfer: ['validate', ({}, cbk) => {
        // Exit early when the invoice has yet to be confirmed
        if (!invoice.is_confirmed) {
          return cbk();
        }

        const otherNodes = nodes.filter(n => n.public_key !== key);

        return asyncDetect(otherNodes, ({lnd}, cbk) => {
          const sub = subscribeToPastPayment({lnd, id: invoice.id});

          sub.once('confirmed', payment => cbk(null, true));
          sub.once('error', () => cbk(null, false));
          sub.once('failed', () => cbk(null, false));
        },
        cbk);
      }],

      // Details for message
      details: [
        'balancedOpen',
        'getNodes',
        'getPayment',
        'getTransfer',
        ({balancedOpen, getNodes, getPayment, getTransfer}, cbk) =>
      {
        // Exit early when the invoice has yet to be confirmed
        if (!invoice.is_confirmed) {
          return cbk();
        }

        // Exit early when this is a node to node transfer
        if (!!getTransfer) {
          return cbk();
        }

        // Exit early when this is a balanced open
        if (!!balancedOpen) {
          return getBalancedOpenMessage({
            lnd,
            capacity: balancedOpen.capacity,
            from: balancedOpen.partner_public_key,
            rate: balancedOpen.fee_rate,
          },
          cbk);
        }

        // Exit early when this is a rebalance
        if (!!getPayment) {
          return getRebalanceMessage({
            lnd,
            fee_mtokens: getPayment.payment.fee_mtokens,
            hops: getPayment.payment.hops,
            payments: invoice.payments,
            received_mtokens: invoice.received_mtokens,
          },
          cbk);
        }

        return getReceivedMessage({
          lnd,
          description: invoice.description,
          payments: invoice.payments,
          received: invoice.received,
          via: getNodes,
        },
        cbk);
      }],

      // Post invoice
      post: ['details', 'getPayment', async ({details, getPayment}) => {
        // Exit early when there is nothing to post
        if (!details) {
          return;
        }

        const receivedOnNode = nodes.length > [key].length ? ` - ${from}` : '';
        const text = `${details.icon} ${details.message}`;

        return await send(id, `${text}${escape(receivedOnNode)}`, sendOptions);
      }],

      // Post quiz
      quiz: ['details', 'post', async ({details, post}) => {
        // Exit early when there is no quiz
        if (!details || !details.quiz || details.quiz.length < minQuizLength) {
          return;
        }

        // Exit early when the quiz has too many answers
        if (details.quiz.length > maxQuizLength) {
          return;
        }

        const [answer] = details.quiz;
        const correct = randomIndex(details.quiz.length);

        const replace = details.quiz[correct];

        // Randomize the position of the correct answer
        const answers = details.quiz.map((n, i) => {
          if (i === correct) {
            return answer;
          }

          if (!i) {
            return replace;
          }

          return n;
        });

        return await quiz({answers, correct, question: details.title});
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
