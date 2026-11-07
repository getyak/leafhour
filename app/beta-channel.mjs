// Public destinations only. An Apple-processed build is not an installation link.
export const betaChannels=Object.freeze({testflightUrl:'https://testflight.apple.com/join/b5vYwr4Z',supportEmail:'support@leafhour.com'});

export function publicTestFlightUrl(value){
 return typeof value==='string'&&/^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]{6,32}$/.test(value)?value:null;
}
