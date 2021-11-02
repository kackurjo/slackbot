import { RTMClient } from '@slack/rtm-api'
import { WebClient } from '@slack/web-api';

const axios = require('axios').default;
const http = require('http');
const xml2js = require('xml2js');
const dotenv = require('dotenv');
const constants = require('./constants');
dotenv.config();

const rtm = new RTMClient(process.env.SLACK_OAUTH_TOKEN)
const web = new WebClient(process.env.SLACK_OAUTH_TOKEN)

let forecast = [];

const parseFMIResponse = (xml) => {
  forecast = [];
  if (!xml['wfs:FeatureCollection']) {
    return forecast;
  }

  xml['wfs:FeatureCollection']['wfs:member'].forEach((memberElem) => {
    const forecastElem = memberElem['BsWfs:BsWfsElement'][0];
    const time = forecastElem['BsWfs:Time'][0];
    let paramName = constants.paramNames[forecastElem['BsWfs:ParameterName'][0].toLowerCase()];
    const rawParamValue = forecastElem['BsWfs:ParameterValue'][0];
    const paramValue = isNaN(rawParamValue) ? rawParamValue : parseFloat(rawParamValue);

    if (paramName === undefined) {
      paramName = forecastElem['BsWfs:ParameterName'][0].toLowerCase();
    }
    const forecastItem = forecast.find(item => item.time === time);
    if (forecastItem !== undefined) {
      forecastItem[paramName] = paramValue;
    } else {
      const paramObject = { time };
      paramObject[paramName] = paramValue;
      forecast.push(paramObject);
    }
  });
  return forecast;
};

const callFMI = ({ url, readyHandler }) => (
  new Promise((resolve, reject) => {
    http.get(url, (response) => {
      response.setEncoding('utf8');
      let responseText = '';
      response.on('data', (chunk) => {
        responseText += chunk;
      });
      response.on('end', () => {
        xml2js.parseString(responseText, (err, result) => {
          if (err) {
            reject(err);
          }
          if (readyHandler !== undefined) {
            resolve(readyHandler(result));
          } else {
            resolve(result);
          }
        });
      });
      response.resume();
    }).on('error', e => reject(e));
  })
);

rtm.start()
  .catch(console.error)

rtm.on('ready', async () => {
  console.log("bot started");
})

rtm.on('slack_event', async (eventType, event) => {
  if (event && event.type === 'message') {
    if (event.text === '!getJoke') {
      await axios.get('http://api.icndb.com/jokes/random?limitTo=[nerdy]').then(function (response) {
        joke(event.channel, event.user, response.data.value.joke)
        return null;
      }).catch(function (error) {
        errorMessage(event.channel, event.user, error)
        console.log(error);
        return null;
      });
    } else if (event.text.split(' ')[0] === '!get') {
      try {
        const date = new Date();
        const enddate = new Date(date);
        enddate.setDate(enddate.getDate() + 1);
        const place = event.text.substr(event.text.indexOf(' ')+1)
        const url = 'http://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::forecast::hirlam::surface::point::simple&tempreature=temperature&endtime=' + enddate.toISOString() + '&place=' + place;
        await callFMI({ url, readyHandler: parseFMIResponse });
        if (forecast.length < 2) {
          errorMessage(event.channel, event.user, "Could not find " + place + " in our registry")
          return null
        }
        weather(event.channel, event.user, forecast, place)
        return null
      } catch (error) {
        errorMessage(event.channel, event.user, error)
        console.log(error)
        return null
      }
    } else if (event.text === '!getCommands') {
      sendMessage(event.channel, `Here is the commans available: \n !get= and then a city like !get=helsinki \n !getJoke to get a joke `)
    }
  }
})

function joke(channelId, userId, text) {
  sendMessage(channelId, `Hello! <@${userId}> \nHeres the joke: ` + text)
}

function weather(channelId, userId, text, place) {
  let forecastMessage = "";
  for (let i = 0; i < text.length; i++) {
    forecastMessage += 'Time: ' + text[i].time.split('T')[0].split('-')[1] + "-" + text[i].time.split('T')[0].split('-')[1] + " " + text[i].time.split('T')[1].split(':')[0] + ":" + text[i].time.split('T')[1].split(':')[1] + ' - Temperature: ' + text[i].temperature + '°C - Wind(m/s): ' + text[i].windspeedms + '\n';
  }
  sendMessage(channelId, `Here is the weather in ` + place + ` <@${userId}>: \n ` + forecastMessage)
}

function errorMessage(channelId, userId, error) {
  sendMessage(channelId, `Hello! <@${userId}> \nThere was a problem: ` + error)
}


async function sendMessage(channel, message) {
  await web.chat.postMessage({
    channel: channel,
    text: message,
  })
}