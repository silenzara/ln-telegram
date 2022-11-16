const fullTokensType = 'full';
const isString = n => typeof n === 'string';
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Format tokens for display

  {
    [none]: <No Value Substitute String>
    tokens: <Tokens Number>
  }

  @returns
  {
    display: <Formtted Tokens String>
  }
*/
module.exports = ({none, tokens}) => {
  if (isString(none) && !tokens) {
    return {display: none};
  }

  // Exit early for tokens environment displays the value with no leading zero
  if (process.env.PREFERRED_TOKENS_TYPE === fullTokensType) {
    let postfix = '';
    if(tokens > 10_000) {
      postfix = 'k';
      tokens = Math.floor(tokens / 100) / 10;
      if(tokens % 1 == 0) postfix = '.0k';
    }

    return {display: `${tokens.toLocaleString()}${postfix}`};
  }

  return {display: tokensAsBigUnit(tokens)};
};
