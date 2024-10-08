/**
   * Demo showing smart card based authentication using WebUSB and CCID
   *
   * Copyright (C) 2017, Jan Birkholz <jbirkholz@users.noreply.github.com >
   */
import * as ccid from "./ccid.js";
import * as ifd from "./ifd.js";
import * as capdu from "./capdu.js";
import * as util from "./util.js";

/**
 * Control displayed status HTML element
 */
let status = { //TODO: idea to put status object into ifd.js and subscribe to it here
  clear: () => {
    document.querySelector("#status").textContent = "";
  },
  show: (message) => {
    document.querySelector("#status").textContent = message;
  }
};

/*
 * Custom Events
 */
document.addEventListener("readerStatus", function (e) { //CustomEvent readerStatus, triggered by ifd.js on document
  status.show(e.detail);
});
document.addEventListener("logEvent", function(e) { //CustomEvent to update debug log
  util.log(e.detail);
  status.clear();
});

//page load
window.addEventListener("load",()=>{
  status.clear();
  ifd.init().catch(error=>{status.show(error);util.log(error,true);throw error;});

  //action event handler
  document.getElementById("requestDevice").addEventListener("click",(clickEvent)=>{
    status.clear();
    return ifd.requestDevice(clickEvent).catch(error=>{status.show(error);util.log(error,true);throw error;});
  });

  //send GET_CHALLENGE to ifd
  document.getElementById("getChallenge").addEventListener("click",()=>{
    status.clear();
    let getChallengeAPDU = capdu.apdus.GET_CHALLENGE(1);
    return ifd.initCard().then(()=>{
      return ifd.sendAPDU(getChallengeAPDU).then(responseAPDU=>{
        util.log(responseAPDU);
      });
    });
  });

  //Verify based on given DF
  document.getElementById("verify").addEventListener("click",()=>{
    status.clear();
    let select = [0x00,0xA4,0x04,0x0C]; //select MF relative, no response expected
    //0x04 ~ select from MF Lc=path without MF identifier
    //0x0C ~ no response data (or proprietary on Le)
    //0x0E ~ Lc = 14Byte

    //build Lc,C from input hex string eg AB0001...
    let verifyPathHexString = document.getElementById("verifyPath").value.replace(/[\s,]/g, ""); //removed whitespaces
    let verifyPathArray = [];
    for(let i=0;i<verifyPathHexString.length;i+=2) {
      let byte = parseInt(verifyPathHexString.slice(i,i+2),16);
      verifyPathArray.push(byte);
    }
    let selectAPDU = new Uint8Array(select.length+1+verifyPathArray.length);
    selectAPDU.set(select,0);
    selectAPDU.set([verifyPathArray.length],select.length);
    selectAPDU.set(verifyPathArray,select.length+1);


    //select applet/file
    return ifd.sendAPDU(selectAPDU).then(responseAPDU=>{
      let data = responseAPDU.slice(0,responseAPDU.length-2); //1 Byte 0-255
      let statusWord = responseAPDU.slice(responseAPDU.length-2,responseAPDU.length);
      if(statusWord[0]!== 0x90 && statusWord[1]!==0x00) {
        let message = "SELECT applet unsuccessful.";
        status.show(message);
        throw new Error(message);
      }

    //verify
    let verifyApdu = new Uint8Array([0x00, 0x20, 0x00, 0x80]); //VERIFY P2:specific reference data e.g. DF
    return ifd.sendAPDU(verifyApdu).then(responseAPDU=>{
      let statusWord = responseAPDU.slice(responseAPDU.length-2,responseAPDU.length);
      if(statusWord[0]== 0x90 && statusWord[1]==0x00) {
        status.show("Authentication successful.")
      } else {
        //TODO: implement unsuccessful verify: 63 cb. [7816-4 Table 6]: 63~warning, cb~counter 11
        status.show("Authentication error.");
        throw new Error("Authentication error."); //caught in error below
      }
    });
  });
});

//change pin after verification
document.getElementById("changePin").addEventListener("click",()=>{
  return ifd.sendAPDU(new Uint8Array([0x00, 0x24, 0x01, 0x80])).then(responseAPDU=>{ //0x24 - change reference data, 0x80~specific
    let statusWord = responseAPDU.slice(responseAPDU.length-2,responseAPDU.length);
    if(statusWord[0]== 0x90 && statusWord[1]==0x00) {
      status.show("Change Pin successful.")
    } else {
      status.show("Change Pin error.");
      throw new Error("Change Pin error.");
    }
  });
});

//PACE using remote terminal (using WebSocketServerPACE.py)
let socket = null;
document.getElementById("sendRemotePACE").addEventListener("click",()=>{
  let msg = document.getElementById("can").value;

    //demo receives apdu on WebSocket open and forwards response message
  if(socket === null || socket.readyState!=1) { //no socket or not opened
    return ifd.initCard().then(initialized=>{ //init card
      if(!initialized) throw new Error("Smart card init failed.");

      //open WebSocket
      socket = new WebSocket('ws://localhost:8081');
      socket.addEventListener("open", openEvent=>{
        socket.send(msg);
      });

      socket.addEventListener("message",msgEvent=>{ //in demo, server controls interaction
        let receivedAPDU = msgEvent.data;

        //extract APDU from Blob
        if(receivedAPDU instanceof Blob) { //python BINARY
          let blobReader = new FileReader();
          blobReader.addEventListener("loadend",event=>{
            let apduArrayBuffer = blobReader.result;
            let receivedAPDUUint8Array = new Uint8Array(apduArrayBuffer);

            //send APDU to ccid
            ifd.sendAPDU(receivedAPDUUint8Array).then(responseAPDU=>{
              util.log(responseAPDU);
              //forward response
              socket.send(responseAPDU);
            });
          });
          blobReader.readAsArrayBuffer(receivedAPDU);
        }
        if(typeof receivedAPDU === "string") {
          if(receivedAPDU==="-1") util.log("PACE failed!");
          if(receivedAPDU==="0") util.log("PACE established!");
        }
      });

      socket.addEventListener("close",closeEvent=>{
        util.log("WebSocket closed.");
      });
    });
  } else {
    //assume card is still initialized
    socket.send(msg);
  }
});

//forward remote APDUs (using WebSocketServer.py)
let remoteAPDUsocket = null;
document.getElementById("remoteAPDU").addEventListener("click",()=>{
  //demo receives apdu on WebSocket open and forwards response message
  if(remoteAPDUsocket === null || remoteAPDUsocket.readyState!=1) {
    return ifd.initCard().then(initialized=>{ //init card
      if(!initialized) throw new Error("Smart card init failed.");

      //open WebSocket
      remoteAPDUsocket = new WebSocket('ws://localhost:8082');
      remoteAPDUsocket.addEventListener("open", openEvent=>{
        remoteAPDUsocket.send(""); //empty string to start server process
      });

      remoteAPDUsocket.addEventListener("message",msgEvent=>{ //in demo, server controls interaction
        let receivedAPDU = msgEvent.data;

        //extract APDU from Blob
        if(receivedAPDU instanceof Blob) {
          let blobReader = new FileReader();
          blobReader.addEventListener("loadend",event=>{
            let apduArrayBuffer = blobReader.result;
            let receivedAPDUUint8Array = new Uint8Array(apduArrayBuffer);

            //send APDU to ccid
            ifd.sendAPDU(receivedAPDUUint8Array).then(responseAPDU=>{
              util.log(responseAPDU);
              //forward response
              remoteAPDUsocket.send(responseAPDU);
            });
          });
          blobReader.readAsArrayBuffer(receivedAPDU);
        } else {
          throw new Error("Blob encoded APDU expected from WebSocket server.");
        }
      });

      remoteAPDUsocket.addEventListener("close",closeEvent=>{
        util.log("WebSocket closed.");
      });
    });
  } else {
    //assume card is still initialized
    remoteAPDUsocket.send("");
  }
});

//forward reader to a websocket server running vicc, which then connects to vpcd (app)
let viccvpcdSocket = null;
document.getElementById("viccvpcd").addEventListener("click",()=>{

if(viccvpcdSocket === null || viccvpcdSocket.readyState!=1) { //no socket or not opened
  return ifd.initCard().then(initialized=>{ //init card
  if(!initialized) throw new Error("Smart card init failed.");

  //open WebSocket
  viccvpcdSocket = new WebSocket('ws://localhost:8083');
  viccvpcdSocket.addEventListener("open", openEvent=>{
    viccvpcdSocket.send("");
  });

  viccvpcdSocket.addEventListener("message",msgEvent=>{ //in demo, server controls interaction
    let receivedAPDU = msgEvent.data;

    //extract APDU from Blob
    if(receivedAPDU instanceof Blob) {
      let blobReader = new FileReader();
      blobReader.addEventListener("loadend",event=>{
        let apduArrayBuffer = blobReader.result;
        let receivedAPDUUint8Array = new Uint8Array(apduArrayBuffer);

        //send APDU to ccid
        ifd.sendAPDU(receivedAPDUUint8Array).then(responseAPDU=>{
          util.log(responseAPDU);
          //forward response
          viccvpcdSocket.send(responseAPDU);
        });
      });
      blobReader.readAsArrayBuffer(receivedAPDU);
    } else {
      throw new Error("Blob encoded APDU expected from WebSocket server.");
    }
  });

  viccvpcdSocket.addEventListener("close",closeEvent=>{
    util.log("WebSocket closed.");
  });
});
} else {
  //assume card is still initialized
  viccvpcdSocket.send("");
}
});

  //dice example using random number from ifd
  let diceElement = document.querySelector("svg#diceSvg");
  diceElement.addEventListener("click", clickEvent => {
    status.clear();
    let getChallengeAPDU = capdu.apdus.GET_CHALLENGE(6); //6 bytes to have a multiple of 6 for the dice (252*6 and 4*6)
    return ifd.initCard().then(()=>{
      return ifd.sendAPDU(getChallengeAPDU).then(responseAPDU=>{
        if(typeof responseAPDU === 'undefined' || responseAPDU.length === 0) throw new Error("Smart card provided no response.");
        util.log(responseAPDU);
        let statusWord = responseAPDU.slice(responseAPDU.length-2,responseAPDU.length);
        if(statusWord[0]!== 0x90 && statusWord[1]!==0x00) throw new Error("Smart card signals error: "+statusWord[0]+" "+statusWord[1]);
        let randomNumberBytes = responseAPDU.slice(0,responseAPDU.length-2); //1 Byte 0-255
        util.log(randomNumberBytes);
        let dicenumber = 7;
        for(let i=0;i<randomNumberBytes.length;i++) {
          let byte = randomNumberBytes[i];
          if(byte<252) { //multiple of 6
            dicenumber=byte%6+1;
          }
          if(i==randomNumberBytes.length-1) { //we have 6 times a number >=252
            //rebuild last number by combining last 2 bits of each of the 6 numbers
            let combinedNumber = 0x00; //will be 0<=x<=23
            for(let j=0;j<randomNumberBytes.length;j++) {
              let lastTwoBits = randomNumberBytes[j]&0x03; //-> 0, 1, 2 or 3
              if(j>0) lastTwoBits++; //for summing up
              combinedNumber+=lastTwoBits;
            }
            dicenumber = combinedNumber%6 +1;
          }
        }

        //let firstRandomNumberByte = randomNumberBytes[0];
        //let diceNumber = firstRandomNumberByte%6+1;
        //diceElement.innerHTML = "<div style='text-align:center;vertical-align:middle;line-height:100px;'>"+diceNumber+"</div>";
        let svgDice = document.querySelector("svg#diceSvg");
        for(var item of document.querySelector("svg#diceSvg").children) {item.style.display ="none";}
        if(isNaN(dicenumber)) dicenumber = 7; //error case
        document.querySelector("svg#diceSvg :nth-child("+dicenumber+")").style.display = "block";
      });
    });
  });

}); //end of load