// Some info. from a python implementation of ANTFS: https://github.com/Tigge/Garmin-Forerunner-610-Extractor

var fs = require('fs'),
    util = require('util'),
    events = require('events'),
    ANT = require('./ant-lib');


   // log  = true;

// Based on https://developer.mozilla.org/en-US/docs/JavaScript/Introduction_to_Object-Oriented_JavaScript
function DeviceProfile(nodeInstance) {
    this.nodeInstance = nodeInstance;
}

DeviceProfile.prototype = {

    DEVICE_TYPE: 0x00,

    parseBurstData: function (channelNr,data) {
        console.log("Parse burst data", data);
    },

    channelResponseEvent: function (data) {
        //console.log("Channel response/event : ", data);
        //return "Not defined";
    },

    getSlaveChannelConfiguration: function () {
        return "Not defined";
    },

    getMasterChannelConfiguration: function () {
        return "Not defined";
    }
};

function DeviceProfile_HRM(nodeInstance) {
    DeviceProfile.call(this, nodeInstance); // Call parent
    this.nodeInstance = nodeInstance;

}

DeviceProfile_HRM.protype = DeviceProfile.prototype;  // Inherit properties/methods

DeviceProfile_HRM.constructor = DeviceProfile_HRM;  // Update constructor

DeviceProfile_HRM.prototype = {

    DEVICE_TYPE: 0x78,

    CHANNEL_PERIOD: 8070,

    // Override/"property shadowing"
    getSlaveChannelConfiguration: function (networkNr, channelNr, deviceNr, transmissionType, searchTimeout) {
        // ANT+ Managed Network Document � Heart Rate Monitor Device Profile  , p . 9  - 4 channel configuration

        var channel = new Channel(channelNr, Channel.prototype.CHANNEL_TYPE.receive_channel, networkNr, Network.prototype.NETWORK_KEY.ANT);

        channel.setChannelId(deviceNr, DeviceProfile_HRM.prototype.DEVICE_TYPE, transmissionType, false);

        channel.setChannelPeriod(DeviceProfile_HRM.prototype.CHANNEL_PERIOD); // Ca. 4 messages pr. second, or 1 msg. pr 246.3 ms -> max HR supported 246.3 pr/minute 
        channel.setChannelSearchTimeout(searchTimeout);
        channel.setChannelFrequency(ANT.prototype.ANT_FREQUENCY);

        channel.broadCastDataParser = this.broadCastDataParser || DeviceProfile.prototype.broadCastDataParser; // Called on received broadcast data

        channel.nodeInstance = this.nodeInstance; // Attach channel to nodeInstance
        channel.deviceProfile = this; // Attach deviceprofile to channel

        this.channel = channel; // Attach channel to device profile
        this.channel.channelResponseEvent = this.channelResponseEvent || DeviceProfile.prototype.channelResponseEvent;

        return channel;
    },

    lostBroadCastData: function () {
        console.log("Lost broadcast data from HRM");
    },

    broadCastDataParser: function (data) {
        var receivedTimestamp = Date.now(),
            self = this;// Will be cannel configuration

        // 0 = SYNC, 1= Msg.length, 2 = Msg. id (broadcast), 3 = channel nr , 4= start of page  ...
        var startOfPageIndex = 4;
        // console.log(Date.now() + " HRM broadcast data ", data);
        var pageChangeToggle = data[startOfPageIndex] & 0x80,
             dataPageNumber = data[startOfPageIndex] & 0x7F;

        //heart
        var page = {
            // Header

            timestamp: receivedTimestamp,
            deviceType: DeviceProfile_HRM.prototype.DEVICE_TYPE,  // Should make it possible to classify which sensors data comes from

            pageChangeToggle: pageChangeToggle,
            dataPageNumber: dataPageNumber,

            heartBeatEventTime: data.readUInt16LE(startOfPageIndex + 4),
            heartBeatCount: data[startOfPageIndex + 6],
            computedHeartRate: data[startOfPageIndex + 7],

        };

        switch (dataPageNumber) {

            case 4: // Main data page

                page.previousHeartBeatEventTime = data.readUInt16LE(startOfPageIndex + 2);


                var rollOver = (page.previousHeartBeatEventTime > page.heartBeatEventTime) ? true : false;

                if (rollOver)
                    page.RRInterval = (0xFFFF - page.previousHeartBeatEventTime) + page.heartBeatEventTime;
                else
                    page.RRInterval = page.heartBeatEventTime - page.previousHeartBeatEventTime;

                if (this.previousHeartBeatEventTime !== page.heartBeatEventTime) {  // Filter out identical messages
                    this.previousHeartBeatEventTime = page.heartBeatEventTime;
                    var msg = "HR " + page.computedHeartRate + " heart beat count " + page.heartBeatCount + " RR " + page.RRInterval;
                    console.log(msg);


                    if (this.timeout) {
                        clearTimeout(this.timeout);
                        //console.log("After clearing", this.timeout);
                        delete this.timeout;
                    }

                    this.timeout = setTimeout(function () { self.deviceProfile.lostBroadCastData(); }, 3000);
                }
                break;

            case 2: // Background data page - sent every 65'th message

                page.manufacturerID = data[startOfPageIndex + 1];
                page.serialNumber = data.readUInt16LE(startOfPageIndex + 2);

                if (this.previousHeartBeatEventTime !== page.heartBeatEventTime) {
                    this.previousHeartBeatEventTime = page.heartBeatEventTime;
                    console.log("Manufacturer " + page.manufacturerID + " serial number : " + page.serialNumber);
                }

                break;

            case 3: // Background data page

                page.hardwareVersion = data[startOfPageIndex + 1];
                page.softwareVersion = data[startOfPageIndex + 2];
                page.modelNumber = data[startOfPageIndex + 3];

                if (this.previousHeartBeatEventTime !== page.heartBeatEventTime) {
                    this.previousHeartBeatEventTime = page.heartBeatEventTime;
                    console.log("HW version " + page.hardwareVersion + " SW version " + page.softwareVersion + " Model " + page.modelNumber);
                }

                break;

            case 1: // Background data page

                page.cumulativeOperatingTime = (data.readUInt32LE(startOfPageIndex + 1) & 0x00FFFFFF) / 2; // Seconds since reset/battery replacement
                if (this.previousHeartBeatEventTime !== page.heartBeatEventTime) {
                    this.previousHeartBeatEventTime = page.heartBeatEventTime;
                    console.log("Cumulative operating time (s) " + page.cumulativeOperatingTime + " hours: " + page.cumulativeOperatingTime / 3600);
                }

                break;

            case 0: // Background - unknown data format
                break;

            default:

                console.log("Page ", dataPageNumber, " not implemented.");
                break;
        }

        this.nodeInstance.broadCast(JSON.stringify(page)); // Send to all connected clients
    }
};

function DeviceProfile_SDM(nodeInstance) {
    DeviceProfile.call(this); // Call parent
    this.nodeInstance = nodeInstance;
}

DeviceProfile_SDM.protype = DeviceProfile.prototype;  // Inherit properties/methods

DeviceProfile_SDM.constructor = DeviceProfile_SDM;  // Update constructor

DeviceProfile_SDM.prototype = {

    DEVICE_TYPE: 0x7C,

    CHANNEL_PERIOD: 8134, // 4 hz

    ALTERNATIVE_CHANNEL_PERIOD: 16268,  // 2 Hz

    // Override/"property shadowing"
    getSlaveChannelConfiguration: function (networkNr, channelNr, deviceNr, transmissionType, searchTimeout) {

        var channel = new Channel(channelNr, Channel.prototype.CHANNEL_TYPE.receive_channel, networkNr, Network.prototype.NETWORK_KEY.ANT);

        channel.setChannelId(deviceNr, DeviceProfile_SDM.prototype.DEVICE_TYPE, transmissionType, false);

        channel.setChannelPeriod(DeviceProfile_SDM.prototype.CHANNEL_PERIOD); // Ca. 4 messages pr. second
        channel.setChannelSearchTimeout(searchTimeout);

        channel.setChannelFrequency(ANT.prototype.ANT_FREQUENCY);

        channel.broadCastDataParser = this.broadCastDataParser || DeviceProfile.prototype.broadCastDataParser; // Called on received broadcast data

        channel.nodeInstance = this.nodeInstance; // Attach channel to nodeInstance
        channel.deviceProfile = this; // Attach deviceprofile to channel


        this.channel = channel; // Attach channel to device profile
        this.channel.channelResponseEvent = this.channelResponseEvent || DeviceProfile.prototype.channelResponseEvent;

        //console.log(channel);
        return channel;

    },

    broadCastDataParser: function (data) {
        //console.log(Date.now() + " SDM broadcast data ", data);
        var receivedTimestamp = Date.now(),
          self = this,
           UNUSED = 0x00,
           msg;// Will be cannel configuration


        // 0 = SYNC, 1= Msg.length, 2 = Msg. id (broadcast), 3 = channel nr , 4= start of page  ...
        var startOfPageIndex = 4;


        var page = {
            // Header
            dataPageNumber: data[startOfPageIndex] & 0x7F,

            timestamp: Date.now()
        };

        switch (page.dataPageNumber) {

            case 1: // Main page
                page.timeFractional = data[startOfPageIndex + 1] * (1 / 200); // s
                page.timeInteger = data[startOfPageIndex + 2];
                page.time = page.timeInteger + page.timeFractional;

                page.distanceInteger = data[startOfPageIndex + 3]; // m
                page.distanceFractional = (data[startOfPageIndex + 4] & 0xF0) * (1 / 16); // Upper 4 bit
                page.distance = page.distanceInteger + page.distanceFractional;

                page.speedInteger = data[startOfPageIndex + 4] & 0x0F; // lower 4 bit
                page.speedFractional = data[startOfPageIndex + 5] * (1 / 256);   // m/s
                page.speed = page.speedInteger + page.speedFractional;

                page.strideCount = data[startOfPageIndex + 6];
                page.updateLatency = data[startOfPageIndex + 7] * (1 / 32); // s

                msg = "";
                if (page.time !== UNUSED)
                    msg += "Time : " + page.time + " s";
                else
                    msg += "Time : UNUSED";

                if (page.distance !== UNUSED)
                    msg += " Distance : " + page.distance + " m";
                else
                    msg += " Distance : UNUSED";

                if (page.speed !== UNUSED)
                    msg += " Speed : " + page.speed;
                else
                    msg += " Speed : UNUSED";

                msg += " Stride count : " + page.strideCount;

                if (page.updateLatency !== UNUSED)
                    msg += " Update latency : " + page.updateLatency + " s";
                else
                    msg += " Update latency : UNUSED";

                console.log(msg);

                break;

            case 2: // Base template 

                page.cadenceInteger = data[startOfPageIndex + 3] * (1 / 200); // s
               page.cadenceFractional = (data[startOfPageIndex + 4] & 0xF0) * (1 / 16);
                page.cadence = page.cadenceInteger + page.cadenceFractional;

                page.speedInteger = data[startOfPageIndex + 4] & 0x0F; // lower 4 bit
                page.speedFractional = data[startOfPageIndex + 5] * (1 / 256);   // m/s
               page.speed = page.speedInteger + page.speedFractional;

                page.status = {
                    SDMLocation: (data[startOfPageIndex + 7] & 0xC0) >> 7,
                    BatteryStatus: (data[startOfPageIndex + 7] & 0x30) >> 4,
                    SDMHealth: (data[startOfPageIndex + 7] & 0x0C) >> 2,
                    UseState: (data[startOfPageIndex + 7] & 0x03)
                };

                switch (page.status.SDMLocation) {
                    case 0x00: page.status.SDMLocationFriendly = "Laces"; break;
                    case 0x01: page.status.SDMLocationFriendly = "Midsole"; break;
                    case 0x02: page.status.SDMLocationFriendly = "Other"; break;
                    case 0x03: page.status.SDMLocationFriendly = "Ankle"; break;
                    default: page.status.SDMLocationFriendly = "? " + page.status.SDMLocation; break;
                }

                switch (page.status.BatteryStatus) {
                    case 0x00: page.status.BatteryStatusFriendly = "OK (new)"; break;
                    case 0x01: page.status.BatteryStatusFriendly = "OK (good)"; break;
                    case 0x02: page.status.BatteryStatusFriendly = "OK"; break;
                    case 0x03: page.status.BatteryStatusFriendly = "Low battery"; break;
                    default: page.status.BatteryStatusFriendly = "? " + page.status.BatteryStatus; break;
                }

                switch (page.status.SDMHealth) {
                    case 0x00: page.status.SDMHealthFriendly = "OK"; break;
                    case 0x01: page.status.SDMHealthFriendly = "Error"; break;
                    case 0x02: page.status.SDMHealthFriendly = "Warning"; break;
                    case 0x03: page.status.SDMHealthFriendly = "Reserved"; break;
                    default: page.status.SDMHealthFriendly = "? " + page.status.SDMHealth; break;
                }

                switch (page.status.UseState) {
                    case 0x00: page.status.UseStateFriendly = "Inactive"; break;
                    case 0x01: page.status.UseStateFriendly = "Active"; break;
                    case 0x02: page.status.UseStateFriendly = "Reserved"; break;
                    case 0x03: page.status.UseStateFriendly = "Reserved"; break;
                    default: page.status.UseStateFriendly = "? " + page.status.UseState; break;
                }


                msg = "";
                if (page.cadence !== UNUSED)
                    msg += "Cadence : " + page.cadence + " strides/min ";
                else
                    msg += "Cadence : UNUSED";

                if (page.speed !== UNUSED)
                    msg += " Speed : " + page.speed;
                else
                    msg += " Speed : UNUSED";


                msg += " Location: " + page.status.SDMLocationFriendly + " Battery: " + page.status.BatteryStatusFriendly + " Health: " + page.status.SDMHealthFriendly + " State: " + page.status.UseStateFriendly;

                console.log(msg);

                break;


            case 0x50: // 80 Common data page

                page.HWRevision = data[startOfPageIndex + 3];
                page.manufacturerID = data.readUInt16LE(4);
                page.modelNumber = data.readUInt16LE(6);

                console.log("HW revision: " + page.HWRevision + " Manufacturer ID: " + page.manufacturerID + " Model : " + page.modelNumber);

                break;

            case 0x51: // 81 Common data page

                page.SWRevision = data[startOfPageIndex + 3];
                page.serialNumber = data.readUInt32LE(4);

                if (page.serialNumber === 0xFFFFFFFF)
                    console.log("SW revision : " + page.SWRevision + " No serial number");
                else
                    console.log("SW revision : " + page.SWRevision + " Serial number: " + page.serialNumber);

                break;

            case 0x52: // 82 Common data page - Battery Status
                //console.log("Battery status : ",data);
                page.descriptive = {
                    coarseVoltage: data[startOfPageIndex + 7] & 0x0F,        // Bit 0-3
                    batteryStatus: (data[startOfPageIndex + 7] & 0x70) >> 4, // Bit 4-6
                    resoultion: (data[startOfPageIndex + 7] & 0x80) >> 7 // Bit 7 0 = 16 s, 1 = 2 s
                };

                var divisor = (page.resolution === 1) ? 2 : 16;


                page.cumulativeOperatingTime = (data.readUInt32LE(startOfPageIndex + 3) & 0x00FFFFFF) / divisor; // 24 - bit only
                page.fractionalBatteryVoltage = data[startOfPageIndex + 6] / 256; // Volt
                if (page.descriptive.coarseVoltage === 0x0F)
                    page.batteryVoltage = "Invalid";
                else
                    page.batteryVoltage = page.fractionalBatteryVoltage + page.descriptive.coarseVoltage;

                msg = "";
                switch (page.descriptive.batteryStatus) {
                    case 0x00: msg += "Reserved"; break;
                    case 0x01: msg += "New"; break;
                    case 0x02: msg += "Good"; break;
                    case 0x03: msg += "OK"; break;
                    case 0x04: msg += "Low"; break;
                    case 0x05: msg += "Critical"; break;
                    case 0x06: msg += "Reserved"; break;
                    case 0x07: msg += "Invalid"; break;
                    default: msg += "? - " + page.descriptive.batteryStatus;
                }

                //console.log(page);

                console.log("Cumulative operating time (s): " + page.cumulativeOperatingTime + " Battery (V) " + page.batteryVoltage + " Battery status: " + msg);
                break;

            default:

                console.log("Page ", page.dataPageNumber, " not implemented.");
                break;
        }
    }
};

function DeviceProfile_ANTFS(nodeInstance) {
    DeviceProfile.call(this); // Call parent
    this.nodeInstance = nodeInstance;

    this.nodeInstance.ANT.addListener(ANT.prototype.EVENT.BROADCAST, this.broadCastDataParser);
    this.nodeInstance.ANT.addListener(ANT.prototype.EVENT.BURST, this.parseBurstData);

    this.state = DeviceProfile_ANTFS.prototype.STATE.INIT; // Init state before first LINK beacon received from device
    //this.stateCounter[DeviceProfile_ANTFS.prototype.STATE.LINK_LAYER] = 0;
    //this.stateCounter[DeviceProfile_ANTFS.prototype.STATE.AUTHENTICATION_LAYER] = 0;
    //this.stateCounter[DeviceProfile_ANTFS.prototype.STATE.TRANSPORT_LAYER] = 0;
    this.CRCUtil = new CRC();

    // Verify that root directory exists

    fs.exists(DeviceProfile_ANTFS.prototype.ROOT_DIR, function (exists) {
        if (!exists) {
            console.log("Root directory did not exists");
            fs.mkdir(DeviceProfile_ANTFS.prototype.ROOT_DIR, function completionCB() {
                console.log("New root directory created at " + DeviceProfile_ANTFS.prototype.ROOT_DIR);
            });
        } else
            console.log("Root directory ", DeviceProfile_ANTFS.prototype.ROOT_DIR);
    });

}

DeviceProfile_ANTFS.protype = DeviceProfile.prototype;  // Inherit properties/methods

DeviceProfile_ANTFS.constructor = DeviceProfile_ANTFS;  // Update constructor

DeviceProfile_ANTFS.prototype = {

    CHANNEL_PERIOD: 4096,

    SEARCH_WAVEFORM: [0x53, 0x00],

    BEACON_ID: 0x43,

    STATE: {
        INIT: 0x0F,
        LINK_LAYER: 0x00,
        AUTHENTICATION_LAYER: 0x01,
        TRANSPORT_LAYER: 0x02,
        BUSY: 0x03,
        0x00: "LINK State",
        0x01: "AUTHENTICATION State",
        0x02: "TRANSPORT State",
        0x03: "BUSY State",
        0x0F: "INIT State"
    },

    // ANTFS TS p. 50 - commands are send either as acknowledged data or bursts depending on payload size
    // COMMAND format : p. 49 ANTFS Command/Response ID = 0x44, Command, Parameters ...
    COMMAND_ID: {
        COMMAND_RESPONSE_ID: 0x44,
        LINK: 0x02,
        DISCONNECT: 0x03,
        AUTHENTICATE: 0x04,
        PING: 0x05,
        DOWNLOAD: 0x09,
        UPLOAD: 0x0A,
        ERASE: 0x0B,
        UPLOAD_DATA: 0x0C,
        AUTHENTICATE_RESPONSE: 0x84,
        DOWNLOAD_RESPONSE: 0x89,
        ERASE_RESPONSE: 0x8B
    },

    // ANTFS TS p. 51
    RESPONSE_ID: {
        authenticate: 0x84,
        download: 0x89,
        upload: 0x8A,
        erase: 0x8b,
        upload_data: 0x8c
    },

    BEACON_CHANNEL_PERIOD: {
        HzHalf: 0x00, // 0.5 Hz
        Hz1: 0x01,
        Hz2: 0x02,
        Hz4: 0x03,
        Hz8: 0x04, // 8 Hz
        0x00: "0.5 Hz (65535)", // 000
        0x01: "1 Hz (32768)",   // 001
        0x02: "2 Hz (16384)",   // 010
        0x03: "4 Hz (8192)",    // 011
        0x04: "8 Hz (4096)",    // 100
        0x07: "Match established channel period (broadcast ANT-FS only)" // 111
    },

    AUTHENTICATION_TYPE: {
        PASS_THROUGH: 0x00,
        PAIRING_ONLY: 0x02,
        PASSKEY_AND_PAIRING_ONLY: 0x03,
        0x00: "Pass-through supported (pairing & passkey optional)",
        0x02: "Pairing only",
        0x03: "Passkey and Pairing only"
    },

    DISCONNECT_COMMAND: {
        RETURN_TO_LINK_LAYER: 0x00,
        RETURN_TO_BROADCAST_MODE: 0x01
        // 2-127 reserved
        // 128 - 255 device specific disconnect
    },

    AUTHENTICATE_COMMAND: {
        PROCEED_TO_TRANSPORT: 0x00, // Pass-through
        REQUEST_CLIENT_DEVICE_SERIAL_NUMBER: 0x01,
        REQUEST_PAIRING: 0x02,
        REQUEST_PASSKEY_EXCHANGE: 0x03
    },

    FRIENDLY_NAME: "ANT USB NODE.JS",

    INITIAL_DOWNLOAD_REQUEST: {
        CONTINUATION_OF_PARTIALLY_COMPLETED_TRANSFER: 0x00,
        NEW_TRANSFER: 0x01
    },

    DOWNLOAD_RESPONSE: {
        REQUEST_OK: 0x00,
        CRC_INCORRECT: 0x05,
        0x00: "Download Request OK",
        0x01: "Data does not exist",
        0x02: "Data exists but is not downloadable",
        0x03: "Not ready to download",
        0x04: "Request invalid",
        0x05: "CRC incorrect"
    },

    ERASE_RESPONSE: {
        ERASE_SUCCESSFULL: 0x00,
        ERASE_FAILED: 0x01,
        NOT_READY: 0x02,
        0x00: "Erase successfull",
        0x01: "Erase failed",
        0x02: "Not ready"
    },

    RESERVED_FILE_INDEX: {
        DIRECTORY_STRUCTURE: 0x00,
        // 0xFC00 - 0xFFFD Reserved
        COMMAND_PIPE: 0xFFFE,
        // 0xFFFF - Reserved
    },

    AUTHENTICATE_RESPONSE : {
        CLIENT_SN: 0x00,
        ACCEPT : 0x01,
        REJECT: 0x02,
        0x00: "Client Device Serial Number",
        0x01: "Accept of pairing or passkey",
        0x02: "Reject"
    },

    DOWNLOAD_BUFFER_MB: 16, // Size of download buffer in MB

    REQUEST_BURST_RESPONSE_DELAY: 3000, // Time in ms. to wait for burst response on a request before retrying previous request

    ROOT_DIR: process.env.HOME + '\\ANTFSNODE',


    setHomeDirectory: function (homeDir) {
        var self = this; // Keep our this reference in callbacks please!

        this.homeDirectory = homeDir;

        fs.exists(this.homeDirectory, function (exists) {
            if (!exists) {
                // try {
                fs.mkdir(self.homeDirectory, function completionCB() {
                    console.log(Date.now() + " Created home directory at " + self.homeDirectory);
                });
                //} catch (e) {
                //    console.log(Date.now() + " Could not create home directory ",util.inspect(e));
                //    throw e;
                //}
            } else
                console.log(Date.now() + " Setting home directory to " + self.homeDirectory);
        });
    },

    getHomeDirectory: function () {
        return this.homeDirectory;
    },

    parseBurstData: function (channelNr,data, parser) {
        var self = this.channelConfiguration[channelNr], beacon, numberOfPackets = data.length / 8,
            authenticate_response = {}, packetNr,
            download_response = {}, currentCRCSeed,
            erase_response = {},
            resumeIndex,
            resumeDataOffset,
             resumeCRCSeed,
             currentDataOffset,
            homeDirectory,
            downloadRequestType;

        function removeLastBlock() {
            // Remove data block with CRC error
            self.deviceProfile.dataOffset.pop();
            self.deviceProfile.dataLength.pop();
            self.deviceProfile.CRCSeed.pop();
        }

        function processRequestCallback() {
            // Call callback if requested
            if (typeof self.deviceProfile.request.callback === "function")
                self.deviceProfile.request.callback.call(self);
            else
                console.warn(Date.now() + " No request callback specified");
        }

        function repeatLastRequest() {
            console.log(Date.now() + " Repeat request", self.deviceProfile.request);

            if (self.deviceProfile.request.request === "download") {
                self.nodeInstance.deviceProfile_ANTFS.sendDownloadRequest.call(self, self.deviceProfile.request.dataIndex, self.deviceProfile.request.dataOffset,
                                       self.deviceProfile.initialRequest, self.deviceProfile.request.CRCSeed, 0, self.deviceProfile.request.callback); // Reuse previous callback for new request

            }
            else
                console.warn(self.deviceProfile.request.request + " request not implemented");
        }

        if (channelNr !== self.number) // Filter out burst for other channels
            return;

        if (self.deviceProfile.timeoutID) {
            clearInterval(self.deviceProfile.timeoutID);
            self.deviceProfile.timeoutRetry = 0;
        }

        //console.log("Got burst data in device profile ANT-FS", data);

        //console.log(Date.now() + " Received ", numberOfPackets, " packets with a total length of ", data.length, " bytes");

        //for (packetNr = 0; packetNr < numberOfPackets; packetNr++)
        //    console.log(packetNr, data.slice(packetNr * 8, 8 + packetNr * 8));

        if (data[0] !== DeviceProfile_ANTFS.prototype.BEACON_ID)
            console.error("Expected beacon id. (0x43) in the first packet of burst payload", data);
        else {
            // Packet 1 BEACON
            beacon = this.nodeInstance.deviceProfile_ANTFS.parseClientBeacon(data, true);
            //console.log("BEACON PARSE", beacon.toString());
            if (beacon.hostSerialNumber !== this.nodeInstance.ANT.serialNumber) {
                console.warn("Beacon in bulk transfer header/packet 1, was for ", beacon.hostSerialNumber, ", our device serial number is ", this.nodeInstance.ANT.serialNumber, "beacon packet ",data);

            } else {
                // Packet 2 ANT-FS RESPONSE
                if (data[8] !== DeviceProfile_ANTFS.prototype.COMMAND_ID.COMMAND_RESPONSE_ID) {
                    console.error("Expected ANT-FS COMMAND ID 0x44 at start of packet 2", data, "bytes:", data.length);
                    repeatLastRequest();
                }
                else {

                    // ANT-FS Command responses
                    switch (data[9]) {
                        // P. 56 ANT-FS spec.
                        case DeviceProfile_ANTFS.prototype.COMMAND_ID.AUTHENTICATE_RESPONSE:

                            authenticate_response.responseType = data[10];
                            authenticate_response.authenticationStringLength = data[11];

                            if (authenticate_response.responseType === DeviceProfile_ANTFS.prototype.AUTHENTICATE_RESPONSE.CLIENT_SN) // For client serial number
                            {
                                authenticate_response.clientSerialNumber = data.readUInt32LE(12);
                                // in this case, authentication string will be the friendly name of the client device
                                if (authenticate_response.authenticationStringLength > 0) {
                                    authenticate_response.authenticationString = data.toString('utf8', 16, 16 + authenticate_response.authenticationStringLength);
                                    authenticate_response.clientFriendlyName = authenticate_response.authenticationString;
                                }

                                // Setup home directory for device - and create device directory under root directory
                                homeDirectory = DeviceProfile_ANTFS.prototype.ROOT_DIR + '\\' + authenticate_response.clientSerialNumber;

                                self.deviceProfile.setHomeDirectory(homeDirectory);

                                if (typeof self.deviceProfile.request.callback === "function")
                                    self.deviceProfile.request.callback();
                                else
                                    console.log(Date.now() + " No callback specified after authentication response for client device serial number");
                            }

                            // Accept of pairing bulk response 
                            // Packet 1 : BEACON            <Buffer 43 24 03 03 96 99 27 00
                            // Packet 2 : ANT-FS RESPONSE           44 84 01 08 00 00 00 00 
                            // Packet 3 : Authentication String :   36 58 b2 a7 8b 3d 2a 98 

                            if (authenticate_response.responseType === DeviceProfile_ANTFS.prototype.AUTHENTICATE_RESPONSE.ACCEPT) // Accept of pairing request or the provided passkey
                            {
                                if (authenticate_response.authenticationStringLength > 0) {
                                    authenticate_response.authenticationString = data.slice(16, 16 + authenticate_response.authenticationStringLength); // Passkey
                                    // TO DO : write to file client serial number + friendlyname + passkey + { channel id (device nr./type+transmission type) ? }
                                    fs.writeFile(self.deviceProfile.getHomeDirectory() + '\\passkey.BIN', authenticate_response.authenticationString, function (err) {
                                        if (err)
                                            console.log(Date.now() + " Error writing to passkey file", err);
                                        else
                                            console.log(Date.now() + " Saved passkey received from device", authenticate_response.authenticationString, "to file : ", self.deviceProfile.getHomeDirectory() + '\\passkey.BIN');
                                    });
                                }
                            }

                            if (authenticate_response.responseType === DeviceProfile_ANTFS.prototype.AUTHENTICATE_RESPONSE.REJECT) // Reject
                            {
                                console.log("Authorization rejected (pairing not accepted or wrong passkey provided)");
                            }

                            // add authenticateResponse to device profile instance
                            self.deviceProfile.authenticate_response = authenticate_response;

                            console.log(Date.now(), authenticate_response, DeviceProfile_ANTFS.prototype.AUTHENTICATE_RESPONSE[authenticate_response.responseType]);
                            break;

                            // Observation : FR 910XT sends data in chuncks of 512 bytes

                        case DeviceProfile_ANTFS.prototype.COMMAND_ID.DOWNLOAD_RESPONSE:
                            // Downloaded file is sent as bulk data is blocks

                            // Packet 2
                            download_response.response = data[10];
                            download_response.responseFriendly = DeviceProfile_ANTFS.prototype.DOWNLOAD_RESPONSE[data[10]];

                            if (download_response.response === DeviceProfile_ANTFS.prototype.DOWNLOAD_RESPONSE.REQUEST_OK) {

                                download_response.totalRemainingLength = data.readUInt32LE(12); // Seems to be equal to block size
                                //if (download_response.totalRemainingLength < 512)
                                //    console.log("Remaining bytes:", download_response.totalRemainingLength);

                                // Packet 3
                                download_response.dataOffset = data.readUInt32LE(16);

                                download_response.fileSize = data.readUInt32LE(20);

                                // Packet 4:N-1
                                download_response.data = data.slice(24, -8); // Last packet is 000000 + 2 CRC bytes -> slice it off -> -8

                                if (download_response.dataOffset === 0) {
                                    self.deviceProfile.downloadFile = new Buffer(DeviceProfile_ANTFS.prototype.DOWNLOAD_BUFFER_MB * 1024 * 1024); // First block of data - allocate 16MB buffer -> should handle most cases if client grows file dynamically
                                    self.deviceProfile.dataOffset = [];
                                    self.deviceProfile.CRCSeed = [];
                                    self.deviceProfile.dataLength = [];
                                }

                                //console.log("Response", download_response);
                                //console.log("Download Data length", download_response.data.length);
                                //console.log("Data length", data.length);
                                //console.log("Last packet of data", data.slice(-8));

                                //for (var eNr = 0; eNr < data.length; eNr++)
                                //    console.log(eNr,data[eNr]);

                                // Put the data chunck received into our buffer at the specified offset
                                download_response.data.copy(self.deviceProfile.downloadFile, download_response.dataOffset);


                                // If more data remains, send a new continuation request for more
                                if (download_response.totalRemainingLength > 0) {

                                    // Packet N
                                    download_response.CRC = data.readUInt16LE(data.length - 2);

                                    // Verify CRC

                                    if (download_response.dataOffset === 0) {
                                        if (self.deviceProfile.request.dataIndex !== 0x00)
                                            console.log(Date.now() + " Expecting a file with size : " + download_response.fileSize, "at directory index ", self.deviceProfile.request.dataIndex);
                                        else
                                            console.log(Date.now() + " Expecting a directory with size : " + download_response.fileSize, "at directory index ", self.deviceProfile.request.dataIndex);

                                        currentCRCSeed = self.nodeInstance.deviceProfile_ANTFS.CRCUtil.CRC_Calc16(download_response.data);
                                        self.deviceProfile.CRCSeed.push(currentCRCSeed);
                                    } else {
                                        currentCRCSeed = self.deviceProfile.CRCSeed[self.deviceProfile.CRCSeed.length - 1];
                                        self.deviceProfile.CRCSeed.push(self.nodeInstance.deviceProfile_ANTFS.CRCUtil.CRC_UpdateCRC16(currentCRCSeed, download_response.data));
                                        currentCRCSeed = self.deviceProfile.CRCSeed[self.deviceProfile.CRCSeed.length - 1];
                                    }


                                    self.deviceProfile.dataLength.push(download_response.totalRemainingLength);
                                    self.deviceProfile.dataOffset.push(download_response.dataOffset);
                                    // console.log("offset", download_response.dataOffset, "data length", download_response.data.length,"total remaining",download_response.totalRemainingLength);

                                    if (download_response.CRC !== currentCRCSeed) {

                                        console.warn(Date.now() + " Block ", self.deviceProfile.dataOffset.length - 1, " CRC of data block ", download_response.CRC, " differs from calculated CRC-16 of data block ", currentCRCSeed);

                                        if (self.deviceProfile.dataOffset.length >= 2) {
                                            resumeIndex = self.deviceProfile.dataOffset.length - 2;
                                            currentDataOffset = self.deviceProfile.dataOffset[resumeIndex] + self.deviceProfile.dataLength[resumeIndex];
                                            currentCRCSeed = self.deviceProfile.CRCSeed[resumeIndex];
                                            downloadRequestType = DeviceProfile_ANTFS.prototype.INITIAL_DOWNLOAD_REQUEST.CONTINUATION_OF_PARTIALLY_COMPLETED_TRANSFER;
                                        }
                                        else // CRC error in block 1
                                        {
                                            resumeIndex = 0;
                                            currentDataOffset = 0;
                                            currentCRCSeed = 0;
                                            downloadRequestType = DeviceProfile_ANTFS.prototype.INITIAL_DOWNLOAD_REQUEST.NEW_TRANSFER;
                                        }

                                        // console.log(self.deviceProfile.dataOffset.length, self.deviceProfile.CRCSeed.length);

                                        removeLastBlock();

                                        // Try to resume download with last good CRC
                                        console.log(Date.now() + " Resume block " + resumeIndex + " data offset: " + currentDataOffset + " CRC Seed: " + currentCRCSeed);

                                    } else
                                        currentDataOffset = download_response.dataOffset + download_response.totalRemainingLength;

                                    self.nodeInstance.deviceProfile_ANTFS.sendDownloadRequest.call(self, self.deviceProfile.request.dataIndex, currentDataOffset,
                                        downloadRequestType, currentCRCSeed, 0, self.deviceProfile.request.callback); // Reuse previous callback for new request

                                    // Kick in retry if no burst response

                                    self.deviceProfile.timeoutID = setInterval(function retry() {
                                        self.deviceProfile.timeoutRetry++;
                                        if (self.deviceProfile.timeoutRetry < 10) {
                                            console.log(Date.now() + " Received no burst response for previous download request in about ", DeviceProfile_ANTFS.prototype.REQUEST_BURST_RESPONSE_DELAY, "ms. Retrying " + self.deviceProfile.timeoutRetry);

                                            self.nodeInstance.deviceProfile_ANTFS.sendDownloadRequest.call(self, self.deviceProfile.request.dataIndex, currentDataOffset,
                                         downloadRequestType, currentCRCSeed, 0, self.deviceProfile.request.callback);
                                        } else {
                                            console.log(Date.now() + " Something is wrong with the link to the device. Cannot proceed. Reached maximum retries.", self.deviceProfile.timeoutRetry);
                                            process.kill(process.pid, 'SIGINT');
                                        }
                                    }, DeviceProfile_ANTFS.prototype.REQUEST_BURST_RESPONSE_DELAY);

                                } else if (download_response.totalRemainingLength === 0) {

                                    self.deviceProfile.response = {
                                        timestamp: Date.now(),
                                        downloadFile: self.deviceProfile.downloadFile.slice(0, download_response.fileSize)
                                    };

                                    if (self.deviceProfile.request.dataIndex !== DeviceProfile_ANTFS.prototype.RESERVED_FILE_INDEX.DIRECTORY_STRUCTURE) {

                                        var fName = self.deviceProfile.getHomeDirectory() + '\\' + self.deviceProfile.directory.index[self.deviceProfile.request.dataIndex].getFileName();
                                        console.log(Date.now() + " Downloaded file ", fName, download_response.fileSize, "bytes");
                                        fs.writeFile(fName, self.deviceProfile.response.downloadFile, function (err) {
                                            if (err)
                                                console.log(Date.now() + " Error writing " + fName, err);
                                            else
                                                console.log(Date.now() + " Saved " + fName);
                                        });

                                    }

                                    processRequestCallback();

                                }
                            } else if (download_response.response === DeviceProfile_ANTFS.prototype.DOWNLOAD_RESPONSE.CRC_INCORRECT) {
                                console.log(Date.now() + " Download response : ", download_response);

                                resumeIndex = self.deviceProfile.dataOffset.length - 2;
                                resumeDataOffset = self.deviceProfile.dataOffset[resumeIndex] + self.deviceProfile.dataLength[resumeIndex];
                                resumeCRCSeed = self.deviceProfile.CRCSeed[resumeIndex];
                                // console.log(self.deviceProfile.dataOffset.length, self.deviceProfile.CRCSeed.length);

                                removeLastBlock();

                                // Try to resume download with last good CRC
                                console.log(Date.now() + " Resume block " + resumeIndex + " data offset: " + resumeDataOffset + " CRC Seed: " + resumeCRCSeed);

                                self.nodeInstance.deviceProfile_ANTFS.sendDownloadRequest.call(self, self.deviceProfile.request.dataIndex, resumeDataOffset,
                                    DeviceProfile_ANTFS.prototype.INITIAL_DOWNLOAD_REQUEST.CONTINUATION_OF_PARTIALLY_COMPLETED_TRANSFER, resumeCRCSeed, 0);

                                self.deviceProfile.timeoutID = setInterval(function retry() {
                                    self.deviceProfile.timeoutRetry++;
                                    if (self.deviceProfile.timeoutRetry < 10) {
                                        console.log(Date.now() + " Received no burst response for previous download request in about ", DeviceProfile_ANTFS.prototype.REQUEST_BURST_RESPONSE_DELAY, "ms . Retrying now.");
                                        self.nodeInstance.deviceProfile_ANTFS.sendDownloadRequest.call(self, self.deviceProfile.request.dataIndex, resumeDataOffset,
                                          DeviceProfile_ANTFS.prototype.INITIAL_DOWNLOAD_REQUEST.CONTINUATION_OF_PARTIALLY_COMPLETED_TRANSFER, resumeCRCSeed, 0);
                                    } else {
                                        console.log(Date.now() + " Lost the link to the device. Cannot proceed.");
                                        process.kill(process.pid, 'SIGINT');

                                    }
                                }, DeviceProfile_ANTFS.prototype.REQUEST_BURST_RESPONSE_DELAY);
                            }
                            else {
                                console.log(Date.now() + " Download response : ", download_response);
                                processRequestCallback();
                            }

                            break;

                        case DeviceProfile_ANTFS.prototype.COMMAND_ID.ERASE_RESPONSE:

                            erase_response.response = data[10];

                            console.log(Date.now() + " Erase response: " + DeviceProfile_ANTFS.prototype.ERASE_RESPONSE[erase_response.response]);

                            if (erase_response.response === DeviceProfile_ANTFS.prototype.ERASE_RESPONSE.ERASE_FAILED ||
                                erase_response.response === DeviceProfile_ANTFS.prototype.ERASE_RESPONSE.NOT_READY) {

                                if (++self.deviceProfile.request.retry <= 3) {
                                    self.nodeInstance.deviceProfile_ANTFS.sendEraseRequest.call(self, self.deviceProfile.request.dataIndex, false);
                                    self.deviceProfile.timeoutID = setInterval(function retry() {
                                        self.deviceProfile.timeoutRetry++;
                                        if (self.deviceProfile.timeoutRetry < 10) {
                                            console.log(Date.now() + " Received no burst response for previous erase request in about", DeviceProfile_ANTFS.prototype.REQUEST_BURST_RESPONSE_DELAY, " ms. Retrying " + self.deviceProfile.timeoutRetry);

                                            self.nodeInstance.deviceProfile_ANTFS.sendEraseRequest.call(self, self.deviceProfile.request.dataIndex, false);
                                        } else {
                                            console.log(Date.now() + " Something is wrong with the link to the device. Cannot proceed.");
                                            process.kill(process.pid, 'SIGINT');
                                        }
                                    }, DeviceProfile_ANTFS.prototype.REQUEST_BURST_RESPONSE_DELAY);
                                }
                                else {
                                    console.log(Date.now() + " Reached maximum number of retries, file is probably not deleted", self.deviceProfile.request.retry);
                                    processRequestCallback();
                                }

                            } else if (erase_response.response === DeviceProfile_ANTFS.prototype.ERASE_RESPONSE.ERASE_SUCCESSFULL) {
                                console.log(Date.now() + " Erased file at index ", self.deviceProfile.request.dataIndex);
                                processRequestCallback();
                            }
                            else
                                console.warn(Date.now() + " Received unknown erase response", erase_response.response);

                            break;

                        default:
                            console.warn(Date.now() + " Not implemented parsing of ANT-FS Command response code ", data[9]);
                            break;
                    }
                }
            }
        }
    },

    ANTFSCOMMAND_Download: function (dataIndex, dataOffset, initialRequest, CRCSeed, maximumBlockSize) {
        //console.log("ANTFSCOMMAND_Download",dataIndex, dataOffset, initialRequest, CRCSeed, maximumBlockSize);

        var payload = new Buffer(16);

        // Packet 1

        payload[0] = DeviceProfile_ANTFS.prototype.COMMAND_ID.COMMAND_RESPONSE_ID; // 0x44;
        payload[1] = DeviceProfile_ANTFS.prototype.COMMAND_ID.DOWNLOAD;
        payload.writeUInt16LE(dataIndex, 2);
        payload.writeUInt32LE(dataOffset, 4);

        // Packet 2

        payload[8] = 0;
        payload[9] = initialRequest;

        if (initialRequest === DeviceProfile_ANTFS.prototype.INITIAL_DOWNLOAD_REQUEST.NEW_TRANSFER) {
            if (CRCSeed !== 0)
                console.warn("CRC seed specified is ", CRCSeed, " for new transfer CRC seed should be set to 0 -> forced to 0 now");
            payload.writeUInt16LE(0, 10); // Force CRC seed to 0
        }
        else
            payload.writeUInt16LE(CRCSeed, 10);

        payload.writeUInt32LE(maximumBlockSize, 12);

        return payload;

    },

    // host serial number is available on antInstance.serialNumber if getDeviceSerialNumber has been executed
    ANTFSCOMMAND_Link: function (channelFreq, channelPeriod, hostSerialNumber) {
        var payload = new Buffer(8);

        payload[0] = DeviceProfile_ANTFS.prototype.COMMAND_ID.COMMAND_RESPONSE_ID; // 0x44;
        payload[1] = DeviceProfile_ANTFS.prototype.COMMAND_ID.LINK;
        payload[2] = channelFreq;    // Offset from 2400 Mhz
        payload[3] = channelPeriod; // 0x04 = 8 Hz
        payload.writeUInt32LE(hostSerialNumber, 4);

        return { buffer: payload, friendly: "ANT-FS LINK Command" };
    },

    // p. 52 ANT-FS technical spec.
    ANTFSCOMMAND_Disconnect: function (commandType, timeDuration, applicationSpecificDuration) {
        // timeDuration - 0x00 - Disabled/Invalid
        // application specific duration - 0x00 - Disabled/Invalid
        var payload = new Buffer(4);

        payload[0] = DeviceProfile_ANTFS.prototype.COMMAND_ID.COMMAND_RESPONSE_ID; // 0x44;
        payload[1] = DeviceProfile_ANTFS.prototype.COMMAND_ID.DISCONNECT;
        payload[2] = commandType;
        payload[3] = timeDuration;
        payload[4] = applicationSpecificDuration;

        return { buffer: payload, friendly: "ANT-FS DISCONNECT Command" };
    },

    ANTFSCOMMAND_Authentication: function (commandType, authStringLength, hostSerialNumber) {
        var payload = new Buffer(8);

        payload[0] = DeviceProfile_ANTFS.prototype.COMMAND_ID.COMMAND_RESPONSE_ID; // 0x44;
        payload[1] = DeviceProfile_ANTFS.prototype.COMMAND_ID.AUTHENTICATE;
        payload[2] = commandType;
        payload[3] = authStringLength; // "Set to 0 if no authentication is to be supplied", "string is bursts to the client immediately following this command", "..If Auth String Length parameter is set to 0, this msg. may be sent as an acknowledged message"
        payload.writeUInt32LE(hostSerialNumber, 4);

        return { buffer: payload, friendly: "ANT-FS AUTHENTICATION Command" };
    },

    ANTFSCOMMAND_Erase: function (dataIndex) {
        var payload = new Buffer(4);

        payload[0] = DeviceProfile_ANTFS.prototype.COMMAND_ID.COMMAND_RESPONSE_ID; // 0x44;
        payload[1] = DeviceProfile_ANTFS.prototype.COMMAND_ID.ERASE;
        payload.writeUInt16LE(dataIndex, 2);

        return { buffer: payload, friendly: "ANT-FS ERASE Command" };
    },

    getSlaveChannelConfiguration: function (networkNr, channelNr, deviceNr, deviceType, transmissionType, searchTimeout) {
        // Setup channel parameters for ANT-FS
        this.channel = new Channel(channelNr, Channel.prototype.CHANNEL_TYPE.receive_channel, networkNr, Network.prototype.NETWORK_KEY.ANTFS);

        this.channel.setChannelId(deviceNr, deviceType, transmissionType, false);
        this.channel.setChannelPeriod(DeviceProfile_ANTFS.prototype.CHANNEL_PERIOD);
        this.channel.setChannelSearchTimeout(ANT.prototype.INFINITE_SEARCH);
        this.channel.setChannelFrequency(ANT.prototype.ANTFS_FREQUENCY);
        this.channel.setChannelSearchWaveform(DeviceProfile_ANTFS.prototype.SEARCH_WAVEFORM);

        this.channel.broadCastDataParser = this.broadCastDataParser || DeviceProfile.prototype.broadCastDataParser;
        this.channel.parseBurstData = this.parseBurstData || DeviceProfile.prototype.parseBurstData; // Called on a complete aggregation of burst packets

        this.channel.channelResponseEvent = this.channelResponseEvent || DeviceProfile.prototype.channelResponseEvent;

        this.channel.nodeInstance = this.nodeInstance; // Attach channel to nodeInstance
        this.channel.deviceProfile = this; // Attach channel to device profile

        return this.channel;
    },

    channelResponseEvent: function (data) {
        //console.log(Date.now() + " Got channelResponseEvent on ANT-FS channel ", data);

    },

    // It seems like the Garmin 910XT ANTFS client open the channel for about 1.75 sec. each 20 seconds. At 8Hz message rate we can expected max 16 beacon messages. -> maybe to conserve power
    // The generates a series of EVENT_RX_FAIL which eventually leads to EVENT_RX_FAIL_GO_TO_SEARCH -> host expected messages to arrive, but
    // client (910XT) has closed the channel, fallback for host is to return to search mode again
    // I suppose that when authentication succeeds and we enter transport layer state, the client will step up its game and provide continous stream of data
    // ANT-FS Technical specification p. 40 s. 9.1 Beacon "Client beacon rates will be application dependent. A trade off is made between power and latecy"
    parseClientBeacon: function (data, onlyDataPayload) {

        // if onlyDataPayload === true, SYNC MSG. LENGTH MSG ID CHANNEL NR is stripped off beacon -> used when assembling burst transfer that contain a beacon in the first packet
        var substract; // Used to get the correct index in the data
        if (typeof onlyDataPayload === "undefined")
            substract = 0;
        else if (onlyDataPayload)
            substract = 4;

        var
            beaconInfo = {
                status1: data[5 - substract],
                status2: data[6 - substract],
                authenticationType: data[7 - substract],
            };

        beaconInfo.dataAvailable = beaconInfo.status1 & 0x20 ? true : false; // Bit 5
        beaconInfo.uploadEnabled = beaconInfo.status1 & 0x10 ? true : false; // Bit 4
        beaconInfo.pairingEnabled = beaconInfo.status1 & 0x08 ? true : false; // Bit 3
        beaconInfo.beaconChannelPeriod = beaconInfo.status1 & 0x7;// Bit 2-0

        beaconInfo.clientDeviceState = beaconInfo.status2 & 0x0F; // Bit 3-0 (0100-1111 reserved), bit 7-4 reserved

        if (beaconInfo.clientDeviceState === DeviceProfile_ANTFS.prototype.STATE.AUTHENTICATION_LAYER || beaconInfo.clientDeviceState === DeviceProfile_ANTFS.prototype.STATE.TRANSPORT_LAYER || beaconInfo.clientDeviceState === DeviceProfile_ANTFS.prototype.STATE.BUSY) {
            beaconInfo.hostSerialNumber = data.readUInt32LE(8 - substract);
        }
        else if (beaconInfo.clientDeviceState === DeviceProfile_ANTFS.prototype.STATE.LINK_LAYER) {
            beaconInfo.deviceType = data.readUInt16LE(8 - substract);
            beaconInfo.manufacturerID = data.readUInt16LE(10 - substract);
        }

        function parseStatus1() {
            var status1Str;

            status1Str = "ANT-FS Beacon ";

            if (beaconInfo.dataAvailable)
                status1Str += "+Data ";
            else
                status1Str += "-Data. ";

            if (beaconInfo.uploadEnabled)
                status1Str += "+Upload ";
            else
                status1Str += "-Upload ";

            if (beaconInfo.pairingEnabled)
                status1Str += "+Pairing ";
            else
                status1Str += "-Pairing ";

            status1Str += "(" + beaconInfo.status1 + ") " + DeviceProfile_ANTFS.prototype.BEACON_CHANNEL_PERIOD[beaconInfo.beaconChannelPeriod];

            return status1Str;

        }

        beaconInfo.toString = function () {

            if (beaconInfo.clientDeviceState === DeviceProfile_ANTFS.prototype.STATE.LINK_LAYER)
                return parseStatus1() + " " + DeviceProfile_ANTFS.prototype.STATE[beaconInfo.status2 & 0x0F] + " Device type " + beaconInfo.deviceType + " Manuf. ID " + beaconInfo.manufacturerID + " " + DeviceProfile_ANTFS.prototype.AUTHENTICATION_TYPE[beaconInfo.authenticationType];
            else
                return parseStatus1() + " " + DeviceProfile_ANTFS.prototype.STATE[beaconInfo.status2 & 0x0F] + " Host SN. " + beaconInfo.hostSerialNumber + " " + DeviceProfile_ANTFS.prototype.AUTHENTICATION_TYPE[beaconInfo.authenticationType];
        };

        return beaconInfo;
    },

    sendLinkCommand: function (errorCallback, successCallback) {
        //console.log("LINK", this); this = channelConfiguration
        var channelNr = this.number, self = this;
        var linkMsg = this.deviceProfile.ANTFSCOMMAND_Link(ANT.prototype.ANTFS_FREQUENCY, DeviceProfile_ANTFS.prototype.BEACON_CHANNEL_PERIOD.Hz8, this.nodeInstance.ANT.serialNumber);
        this.nodeInstance.ANT.sendAcknowledgedData(channelNr, linkMsg, errorCallback, successCallback);
    },

    sendDisconnect: function (errorCallback, successCallback) {
        var channelNr = this.number, self = this;
        var disconnectMsg = this.deviceProfile.ANTFSCOMMAND_Disconnect(DeviceProfile_ANTFS.prototype.DISCONNECT_COMMAND.RETURN_TO_LINK_LAYER, 0x00, 0x00);
        this.nodeInstance.ANT.sendAcknowledgedData(channelNr, disconnectMsg, errorCallback,
            function () {
                // For FR 910XT -> only 1 or 2 LINK messages are received after disconnect before device channel is closed
                // To prevent LINK command being sent, its possible to set a flag to indicate that we don't want to do any
                // connection to the device in 10 seconds.
                console.log(Date.now() + " Disconnect ackowledged by device. Earliest reconnection will take place in about 10 seconds.");
                self.deviceProfile.DONT_CONNECT = true;
                setTimeout(function () {
                    delete self.deviceProfile.DONT_CONNECT;
                }, 10000);
                successCallback();
            });
    },

    // Sending this command -> gives a burst of 4 packets 9 bytes in length (including CS/CRC); auth. beacon + 0x84 authenticate response + authorization string on the FR 910XT
    //1368702944969 Rx:  <Buffer a4 09 50 01 43 04 01 03 96 99 27 00 91> * NO parser specified *
    //1368702944972 Rx:  <Buffer a4 09 50 21 44 84 00 10 30 67 0b e5 b5> * NO parser specified *
    //1368702944975 Rx:  <Buffer a4 09 50 41 46 6f 72 65 72 75 6e 6e 85> * NO parser specified *
    //1368702944983 Rx:  <Buffer a4 09 50 e1 65 72 20 39 31 30 58 54 1f> * NO parser specified *
    sendRequestForClientDeviceSerialNumber: function (errorCB, successCB, authenticationResponseCB) {
        var channelNr = this.number, self = this;
        var authMsg = this.deviceProfile.ANTFSCOMMAND_Authentication(DeviceProfile_ANTFS.prototype.AUTHENTICATE_COMMAND.REQUEST_CLIENT_DEVICE_SERIAL_NUMBER, 0, this.nodeInstance.ANT.serialNumber);
        // It's OK to send it as an acknowledgedData if authentication string length is 0, otherwise a burst must be used

        self.deviceProfile.request = {
            timestamp: Date.now(),
            request: 'authenticate_client_device_serial_number',
            callback: authenticationResponseCB, // When authentication response is received as a burst
        };

        this.nodeInstance.ANT.sendAcknowledgedData(channelNr, authMsg,
            function error(err) {
                console.log(Date.now() + " Could not send request for client device serial number", error);
                errorCB(err);

            },
            function success() {
                console.log(Date.now() + " Request for client device serial number acknowledged by device.");
                if (typeof successCB === "function")
                    successCB();
                else
                    console.warn(Date.now() + " No callback specified after send request for client device serial number");
            });
    },

    // Pairing request sent to client device, if friendlyname is provided its sent as a bulk data request otherwise acknowledged
    sendRequestForPairing: function (friendlyName, errorCB, successCB) {
        var channelNr = this.number, self = this, authStringLength = 0, authenticationString;

        if (typeof friendlyName === "undefined")
            console.warn("No friendly name of ANT-FS host specified - will be unknown during pairing");
        else {
            authStringLength = friendlyName.length;
            authenticationString = new Buffer(friendlyName, "utf8");
        }

        var authMsg = this.deviceProfile.ANTFSCOMMAND_Authentication(DeviceProfile_ANTFS.prototype.AUTHENTICATE_COMMAND.REQUEST_PAIRING, authStringLength, this.nodeInstance.ANT.serialNumber);

        // Observation : client will signal state BUSY and pop up user dialog for "Pair with unknown - Yes/No". If yes then client enter transport state. If no,
        // client closes channel -> we get EVENT_RX_FAIL ... EVENT_RX_FAIL_GO_TO_SEARCH
        if (authStringLength === 0) {
            // It's OK to send it as an acknowledgedData if authentication string length is 0, otherwise a burst must be used
            this.nodeInstance.ANT.sendAcknowledgedData(channelNr, authMsg,
                function error() {
                    console.log(Date.now() + " Could not send acknowledged message request for pairing for unknown ANT-FS host ");
                    errorCB();
                },
                function success() {
                    console.log(Date.now() + " Request for pairing sent as acknowledged message for unknown ANT-FS host.");
                    successCB();
                });
        } else {
            var data = Buffer.concat([authMsg.buffer, authenticationString]);
            this.nodeInstance.ANT.sendBurstTransfer(channelNr, data, function error(err) {
                console.log(Date.now() + " Failed to send burst transfer with request for pairing", err);
            },
                function success() { console.log(Date.now() + " Sent burst transfer with request for pairing", data); }, "Pairing request");
        }
    },

    sendRequestWithPasskey: function (passkey, errorCB, successCB) {
        var authStringLength, authMsg, data, authenticationString, channelNr = this.number, self = this;

        if (typeof passkey === "undefined") {
            console.warn(Date.now() + " No passkey specified");
            return;
        }
        else {
            authStringLength = passkey.length;
            authenticationString = passkey;
        }

        authMsg = this.deviceProfile.ANTFSCOMMAND_Authentication(DeviceProfile_ANTFS.prototype.AUTHENTICATE_COMMAND.REQUEST_PASSKEY_EXCHANGE, authStringLength, this.nodeInstance.ANT.serialNumber);

        data = Buffer.concat([authMsg.buffer, authenticationString]);
        this.nodeInstance.ANT.sendBurstTransfer(channelNr, data, function error(err) { console.log(Date.now() + " Failed to send burst transfer with passkey", err); errorCB(error); },
            function success() { console.log(Date.now() + " Sent burst transfer with passkey", data); successCB(); }, "Transfer with passkey");
    },

    // Parses ANT-FS directory at reserved file index 0
    parseDirectory: function (data) {
        var self = this, numberOfFiles, fileNr, file, structureLength, addIndex, totalBytesInDirectory = 0;

        self.deviceProfile.directory = {
            header: {
                version: {
                    major: data[0] & 0xF0,
                    minor: data[0] & 0xF0
                },
                structureLength: data[1],
                timeFormat: data[2],
                //reserved -5 bytes pad 0
                currentSystemTime: data.readUInt32LE(8),
                directoryLastModifiedDateTime: data.readUInt32LE(12),
            },
            index: [],
            newIndex: [], // Index of new files
            downloadIndex: [], //Index of readable/downloadable files
            eraseIndex: [] // Index of erasable files
        };

        structureLength = self.deviceProfile.directory.header.structureLength;
        numberOfFiles = (data.length - 2 * 8) / structureLength;
        console.log("Number of files in directory", numberOfFiles);

        function getDataSubTypeFriendly(subtype) {
            var stype;
            switch (subtype) {
                case 1: stype = "Device capabilities"; break;
                case 2: stype = "Settings"; break;
                case 3: stype = "Sport settings"; break;
                case 4: stype = "Activity"; break;
                case 5: stype = "Workout"; break;
                case 6: stype = "Course"; break;
                case 7: stype = "Schedules"; break;
                case 8: stype = "Locations"; break;
                case 9: stype = "Weight"; break;
                case 10: stype = "Totals"; break;
                case 11: stype = "Goals"; break;
                case 14: stype = "Blood Pressure"; break;
                case 15: stype = "Monitoring"; break;
                case 20: stype = "Activity Summary"; break;
                case 28: stype = "Daily Monitoring"; break;
                default: stype = subtype.toString(); break;
            }
            return stype;
        }

        function getDateAsString(date, useFormatting) {
            var dateStr;

            function formatDate(fDate) {
                var dateAsString = fDate.toISOString();
                // Remove millisec.
                // ISO : 1989-12-31T00:00:00.000Z
                dateAsString = dateAsString.substring(0, dateAsString.length - 5);
                dateAsString = dateAsString.replace(new RegExp(":", "g"), "-");
                //dateAsString = dateAsString.replace("T", "-");
                return dateAsString;
            }

            if (date === 0xFFFFFFFF || date === 0x00)
                dateStr = "UnknownDate"+'-'+date+'-'+Date.now().toString();
            else if (date < 0x0FFFFFFF)
                dateStr = "System-Custom " + date;
            else if (this.date !== 0)
                if (useFormatting)
                    dateStr = formatDate(new Date(Date.UTC(1989, 11, 31, 0, 0, 0, 0) + date * 1000));
                else
                    dateStr = (new Date(Date.UTC(1989, 11, 31, 0, 0, 0, 0) + date * 1000)).toString();

            return dateStr;
        }

        function getFileName() {
            if (this.dataType === 0x80)
                return function () { return this.dataTypeFriendly + "-" + this.dataSubTypeFriendly + "-" + this.index + "-" + getDateAsString(this.date, true) + ".FIT" };
            else
                return function () { return this.dataTypeFriendly + "-" + getDateAsString(this.date) + "-" + this.index + ".BIN"; };
        }

        function AsString() {
            var generalFlags = "", dataType = this.dataType, date = "", number = "", dataTypeFlags = "",
                dataSubType = "";

            // Date is number of sec. elapsed since 00:00 of Dec. 31, 1989

            //if (this.date === 0xFFFFFFFF || this.date === 0x00)
            //    date = "Unknown";
            //else if (this.date < 0x0FFFFFFF)
            //    date = "System/Custom " + this.date;
            //else if (this.date !== 0)
            //    date = new Date(Date.UTC(1989, 11, 31, 0, 0, 0, 0) + this.date * 1000);

            date = getDateAsString(this.date);

            if (this.generalFlags.read) 
                generalFlags += "download";

            if (this.generalFlags.write)
                generalFlags += '_upload';

            if (this.generalFlags.erase)
                generalFlags += '_erase';
             
            if (this.generalFlags.archive)
                generalFlags += '_archive';

            if (!this.generalFlags.archive) 
                generalFlags += '_NEW';
          
            if (this.generalFlags.append)
                generalFlags += '_append';

            if (this.generalFlags.crypto)
                generalFlags += '_crypto';


            if (this.dataTypeFlags !== 0x00)
                dataTypeFlags = this.dataTypeFlags;

            if (this.dataType <= 0x0F)
                dataType += " Manufacturer/Device";

            if (this.dataType === 0x80) {

                if (this.number !== 0xFFFF)
                    number = this.dataSubType;

                // FIT Files Types document in the FIT SDK 
                dataSubType = getDataSubTypeFriendly(this.dataSubType);

                // Number skipped (seems to be the same as dataSubTupe) for FR 910XT
                dataType += " " + this.dataTypeFriendly + " " + dataSubType;
            }
            // (Skip this.identifier in output->not useful)
            return function () { return "Index " + this.index + " " + dataType + " " + dataTypeFlags + " " + generalFlags + " " + this.size + " " + date };
        }

        for (fileNr = 0; fileNr < numberOfFiles; fileNr++) {

            addIndex = fileNr * structureLength;

            file = {
                buffer: data.slice(16 + addIndex, 16 + addIndex + structureLength),
                index: data.readUInt16LE(16 + addIndex),
                dataType: data[18 + addIndex],
                identifier: data.readUInt32LE(19 + addIndex) & 0x00FFFFFF,
                dataTypeFlags: data[22 + addIndex],
                generalFlags: {
                    read: data[23 + addIndex] & 0x80 ? true : false,
                    write: data[23 + addIndex] & 0x40 ? true : false,
                    erase: data[23 + addIndex] & 0x20 ? true : false,
                    archive: data[23 + addIndex] & 0x10 ? true : false,
                    append: data[23 + addIndex] & 0x08 ? true : false,
                    crypto: data[23 + addIndex] & 0x04 ? true : false,
                    //reserved bit 0-1
                },
                size: data.readUInt32LE(24 + addIndex),
                date: data.readUInt32LE(28 + addIndex)
            };

            // Update index for new,downloadable,erasable files
            if (!file.generalFlags.archive)
              self.deviceProfile.directory.newIndex.push(file.index); // Keeps the index new files

            if (file.generalFlags.read)
                self.deviceProfile.directory.downloadIndex.push(file.index);

            if (file.generalFlags.erase)
                self.deviceProfile.directory.eraseIndex.push(file.index);

            totalBytesInDirectory += file.size;

            if (file.dataType === 0x80) // FIT 
            {
                file.dataTypeFriendly = 'FIT';
                file.dataSubType = data[19 + addIndex];
                file.dataSubTypeFriendly = getDataSubTypeFriendly(data[19 + addIndex]);
                file.number = data.readUInt16LE(20 + addIndex);
            } else
                file.dataTypeFriendly = 'Datatype-' + file.dataType.toString();

            // console.log(file);
            self.deviceProfile.directory.index[file.index] = file; 

            file.getFileName = getFileName.call(file);
            // Drawback : each instance a function -> maybe move to a prototype
            file.toString = AsString.call(file);

            console.log(file.toString());

        }

        console.log("Total bytes in directory : ", totalBytesInDirectory);

        if (self.deviceProfile.directory.newIndex.length > 0)
            console.log("New files : ", self.deviceProfile.directory.newIndex.length);
        else
            console.log("All files archived/previously downloaded");

        if (self.deviceProfile.directory.downloadIndex.length > 0)
            console.log("Downloadable/readable files : ", self.deviceProfile.directory.downloadIndex.length);
        else
            console.log("No downloadable/readable files available");

        if (self.deviceProfile.directory.eraseIndex.length > 0)
            console.log("Erasable files : ", self.deviceProfile.directory.eraseIndex.length);
        else
            console.log("No erasable files in directory");

        //console.log(self.deviceProfile.directory);
    },

    sendDownloadRequest: function (dataIndex, dataOffset, initialRequest, CRCSeed, maximumBlockSize, downloadFinishedCB) {
        var downloadMsg, channelNr = this.number, self = this;
        //dataParser = parser;

        //if (dataIndex === 0x00) // For directory choose default parser
        //     dataParser = self.nodeInstance.deviceProfile_ANTFS.parseDirectory;

        if (initialRequest === DeviceProfile_ANTFS.prototype.INITIAL_DOWNLOAD_REQUEST.NEW_TRANSFER) {
            if (typeof downloadFinishedCB === "undefined")
                console.warn(Date.now() + " No callback specified for further processing after download");

            self.deviceProfile.request = {
                timestamp: Date.now(),
                request: 'download',
                dataIndex: dataIndex,
                initialRequest : initialRequest,
                //parser: dataParser,
                callback: downloadFinishedCB, // When download is finished
            };
        } else {
            self.deviceProfile.request.dataOffset = dataOffset;
            self.deviceProfile.request.CRCSeed = CRCSeed;
            self.deviceProfile.request.maximumBlockSize = maximumBlockSize;
            self.deviceProfile.initialRequest = initialRequest;
        }

        // console.log(Date.now() + "dataIndex:", dataIndex, "offset:", dataOffset, "initreq.:", initialRequest, "crcseed:", CRCSeed, "maxblocksize:", maximumBlockSize);

        downloadMsg = self.deviceProfile.ANTFSCOMMAND_Download(dataIndex, dataOffset, initialRequest, CRCSeed, maximumBlockSize);

        function retry() {
            if (self.deviceProfile.lastBeacon.beacon.clientDeviceState === DeviceProfile_ANTFS.prototype.STATE.BUSY) {
                console.log(Date.now() + " Client is busy. Delaying burst of download request with 1000 ms");
                setTimeout(function () { retry(); }, 1000);
            }
            else
                self.nodeInstance.ANT.sendBurstTransfer(channelNr, downloadMsg, function error() { console.log(Date.now() + " Failed to send burst transfer with download request"); },
           function success() {
               console.log(Date.now()+" Sent burst transfer with download request dataIndex: %d dataOffset %d CRC seed %d",dataIndex,dataOffset,CRCSeed);
           }, "DownloadRequest index: " + dataIndex + " data offset: " + dataOffset + " initial request: " + initialRequest + "CRC seed: " + CRCSeed + "max. block size: " + maximumBlockSize);
        }

        retry();
    },

    sendEraseRequest: function (dataIndex, initRequest, eraseFinishedCB) {
        var eraseMsg, channelNr = this.number, self = this;

        //self.deviceProfile.dataIndex = dataIndex; // Reference to requested dataIndex -> used for continuation of download

        if (initRequest) // if not initRequest its a retry request
        self.deviceProfile.request = {
            timestamp: Date.now(),
            request: 'erase',
            retry : 0,  // Number of retries
            dataIndex: dataIndex,
            callback: eraseFinishedCB, // When we got erase response
        };

        eraseMsg = self.deviceProfile.ANTFSCOMMAND_Erase(dataIndex);

        console.log(self.deviceProfile.request, eraseMsg);

        function retryIfBusy() {
            if (self.deviceProfile.lastBeacon.beacon.clientDeviceState === DeviceProfile_ANTFS.prototype.STATE.BUSY) {
                console.log(Date.now() + " Client is busy. Delaying burst of erase request with 1000 ms");
                setTimeout(function () { retryIfBusy(); }, 1000);
            }
            else
                self.nodeInstance.ANT.sendAcknowledgedData(channelNr, eraseMsg,
                    function error() {
                        console.log(Date.now() + " Failed to send acknowledged transfer with erase request");
                    },
                   function success() {
                       console.log(Date.now() + " Sent acknowledged transfer with erase request", eraseMsg);
                   }, "EraseRequest index: " + dataIndex);
        }

        retryIfBusy();
    },

    downloadMultipleFiles: function (files, completeCB) {
        var self = this;

        console.log(Date.now() + " Downloading ", files.length, " files.");

        function downloadNextFile() {
            var nextFileIndex = files.shift();
            if (typeof nextFileIndex !== "undefined")
                self.nodeInstance.deviceProfile_ANTFS.sendDownloadRequest.call(self, nextFileIndex, 0,
                    DeviceProfile_ANTFS.prototype.INITIAL_DOWNLOAD_REQUEST.NEW_TRANSFER, 0, 0, function downloadFinishedCB() {
                        downloadNextFile();
                    });
            else
                if (typeof completeCB !== "function")
                    console.warn(Date.now() + " No completion callback specified after download");
                else
                    completeCB();

        }

        downloadNextFile();

    },

    eraseMultipleFiles: function (files, completeCB) {
        var self = this;

        console.log(Date.now() + " Erasing ", files.length, " files.");

        function eraseNextFile() {
            var nextFileIndex;
            if (typeof files === 'object')
                nextFileIndex = files.shift();
            
            if (typeof nextFileIndex !== "undefined")

            self.nodeInstance.deviceProfile_ANTFS.sendEraseRequest.call(self, nextFileIndex, true, function complete() {
                eraseNextFile();
            });

            else
                if (typeof completeCB !== "function")
                    console.warn(Date.now() + " No completion callback specified after erase");
                else
                    completeCB();

        }

        eraseNextFile();

    },

    disconnectFromDevice: function (completeCB) {
        var self = this;
        self.nodeInstance.deviceProfile_ANTFS.sendDisconnect.call(self, function error() {
            console.log(Date.now() + " Failed to send ANT-FS disconnect command to device");
            // delete self.deviceProfile.sendingLINK;
        },
                                         function success() {
                                            // delete self.deviceProfile.download;
                                             console.log(Date.now() + " ANT-FS disconnect command acknowledged by device. Device should return immediatly to LINK layer.");

                                             if (typeof completeCB === "function")
                                                 completeCB();
                                             else
                                                 console.warn(Date.now() + " No completion callback specified after disconnect");

                                         }); // Request device return to LINK layer
    },

    // Listener for broadcast event for all channels -> must filter
    // When this function is called from emit function of EventEmitter -> this will be the eventEmitter = ANT instance
    // This can be verified by looking at the code for emit in REPL console : console.log((new (require('events').EventEmitter)).emit.toString()) ->
    // event handler is called using handler.call(this=ANT Instance,...)
    broadCastDataParser: function (data) {
        var beaconID = data[4], channelNr = data[3],
            beacon, self = this.channelConfiguration[channelNr],
            retryLINK = 0, currentCommand;
        // Check for valid beacon ID 0x43 , p. 45 ANT-FS Technical Spec.

        // Important !
        if (channelNr !== self.number) // Only handle channel broadcast for this particular channel (FILTER OUT OTHER CHANNELS)
            return;

        if (typeof self.deviceProfile.DONT_CONNECT !== "undefined")  // Prevent re-connection for 10 seconds after a disconnect command is sent to the device
            return;

        
        //if (beaconID !== DeviceProfile_ANTFS.prototype.BEACON_ID)
        //    console.log(Date.now()+" Got a normal broadcast. Awaiting beacon broadcast from device.", data);
        if (beaconID === DeviceProfile_ANTFS.prototype.BEACON_ID) {

            // If we not have updated channel id, then get it

            beacon = self.nodeInstance.deviceProfile_ANTFS.parseClientBeacon(data);

            self.deviceProfile.lastBeacon = { beacon: beacon, timestamp: Date.now() };

            console.log(Date.now() + " " + beacon.toString());

            clearTimeout(self.deviceProfile.linkLayerTimeout);

            switch (beacon.clientDeviceState) {

                case DeviceProfile_ANTFS.prototype.STATE.LINK_LAYER:

                    self.deviceProfile.state = DeviceProfile_ANTFS.prototype.STATE.LINK_LAYER; // Follow same state in host as the device/client;
                    // self.deviceProfile.stateCounter[DeviceProfile_ANTFS.prototype.STATE.LINK_LAYER]++;
                    
                    self.deviceProfile.linkLayerTimeout = setTimeout(function () {
                        console.log(Date.now() + " Did not receive any LINK beacon from device in 1 second, connection probably lost/device closed channel");
                    }, 1000);

                    if (beacon.dataAvailable || self.nodeInstance.commandQueue.length > 0) // Only go to auth. layer if new data is available or there is more commands to process
                    {
                        if (self.nodeInstance.commandQueue.length === 0 && beacon.dataAvailable) {
                            console.log(Date.now() + " LINK beacon reports data available, scheduling download of new files");
                            self.nodeInstance.commandQueue.push(Node.prototype.COMMAND.DOWNLOAD_NEW);
                        }

                        switch (beacon.authenticationType) {

                            case DeviceProfile_ANTFS.prototype.AUTHENTICATION_TYPE.PASSKEY_AND_PAIRING_ONLY:

                                // Do not enter this region more than once (can reach 8 beacon msg. pr sec === channel period)
                                if (typeof self.deviceProfile.sendingLINK === "undefined") {
                                    self.deviceProfile.sendingLINK = true;

                                    function retryLink() {
                                        if (++retryLINK < 10) {
                                            self.nodeInstance.deviceProfile_ANTFS.sendLinkCommand.call(self,
                                                function error() {
                                                    console.log(Date.now() + " Failed to send ANT-FS link command to device");
                                                    delete self.deviceProfile.sendingLINK;

                                                },
                                                function success() {
                                                    console.log(Date.now() + " ANT-FS link command acknowledged by device.");
                                                    // Device should transition to authentication beacon now if all went well
                                                    setTimeout(function handler() {
                                                        if (typeof self.deviceProfile.sendingLINK !== "undefined") {
                                                            console.log(Date.now() + " Device did not transition to authentication state. Retrying when LINK beacon is received from device.");
                                                            delete self.deviceProfile.sendingLINK;
                                                        }
                                                    }, 10000); // Allow resend of LINK after 10 sec.
                                                }
                                                );
                                        } else {
                                            console.error(Date.now() + " Reached maximum number of retries of sending LINK command to device.");
                                        }
                                    }

                                    retryLink();
                                }

                                break;

                            default:
                                console.error("Authentication type not implemented, cannot proceed to transport layer ", DeviceProfile_ANTFS.prototype.AUTHENTICATION_TYPE[beacon.authentication], "(" + beacon.authentication + ")");
                                break;
                        }
                    }

                    break;

                case DeviceProfile_ANTFS.prototype.STATE.AUTHENTICATION_LAYER:
                    // One exception is EVENT_TRANSFER_TX_FAILED of link command (but device got the command and still sends AUTHENTICATION BEACON)  
                    self.deviceProfile.state = DeviceProfile_ANTFS.prototype.STATE.AUTHENTICATION_LAYER;// Follow same state in host as the device/client;

                    delete self.deviceProfile.sendingLINK;

                    // Is authentication beacon for us?

                    if (beacon.hostSerialNumber !== self.nodeInstance.ANT.serialNumber)
                        console.warn("Authentication beacon was for ", beacon.hostSerialNumber, ", our device serial number is ", self.nodeInstance.ANT.serialNumber);
                    else
                        if (typeof self.deviceProfile.sendingAUTH_CLIENT_SN === "undefined") {
                            self.deviceProfile.sendingAUTH_CLIENT_SN = true;
                            // Observation: client device will transmit AUTHENTICATION beacon for 10 seconds after receiving this request
                            self.nodeInstance.deviceProfile_ANTFS.sendRequestForClientDeviceSerialNumber.call(self, function error(err) {
                                delete self.deviceProfile.sendingAUTH_CLIENT_SN; // Allow resend
                            }, function success() {
                                // Device will send a authentication burst response after a short while after receiving the authentication request
                            },
                            
                            // Callback from parseBurstData when authentication response is received from the device
                            function authenticationCB() {
                                // Try to read passkey from file
                                var passkeyFileName = self.deviceProfile.getHomeDirectory() + '\\passkey.BIN';
                                console.log(Date.now() + " Trying to find passkey file at ", passkeyFileName);
                                fs.exists(passkeyFileName, function (exists) {
                                    if (exists) {
                                        console.log(Date.now() + " Found passkey.bin file");
                                        fs.readFile(passkeyFileName, function (err, data) {
                                            if (err) throw err;
                                            self.deviceProfile.passkey = data;
                                            //console.log(data);
                                            self.nodeInstance.deviceProfile_ANTFS.sendRequestWithPasskey.call(self, data, function error(err) {
                                                delete self.deviceProfile.sendingAUTH_CLIENT_SN;
                                            }, function success() {
                                            });
                                        });
                                    }
                                    else {
                                        console.log(Date.now() + " Did not find passkey.bin file, requesting pairing with device");
                                        self.nodeInstance.deviceProfile_ANTFS.sendRequestForPairing.call(self, DeviceProfile_ANTFS.prototype.FRIENDLY_NAME, function error(err) {
                                            delete self.deviceProfile.sendingAUTH_CLIENT_SN;
                                        }, function success() {

                                        });
                                    }
                                });
                            });
                            //else
                            //    console.log("SKIPPING AUTH BEACON, waiting for request for client device serial number");
                        }

                    break;

                case DeviceProfile_ANTFS.prototype.STATE.TRANSPORT_LAYER:

                    self.deviceProfile.state = DeviceProfile_ANTFS.prototype.STATE.TRANSPORT_LAYER;
                    delete self.deviceProfile.sendingAUTH_CLIENT_SN;
                    // If no transmission takes place on the established link, client will close channel in 10 seconds and return to LINK state.
                    // p. 56 in ANT-FS spec. PING-command 0x05 can be sent to keep alive link to reset client device connection timer
                    
                    if (typeof self.deviceProfile.processingCommand === "undefined") { // Can only process one command at a time
                        self.deviceProfile.processingCommand = true;

                        console.log("COMMAND QUEUE:",self.nodeInstance.commandQueue);
                        currentCommand = self.nodeInstance.commandQueue.shift(); // Take next command
                      

                        if (typeof currentCommand === "undefined") {
                            console.warn(Date.now() + " No commands available for further processing");
                            self.nodeInstance.deviceProfile_ANTFS.disconnectFromDevice.call(self, function () { });
                            //delete self.deviceProfile.processingCommand;
                            // Won't allow more processing in transport layer now, client device will return to 
                        }
                        else
                            switch (currentCommand) {

                                case Node.prototype.COMMAND.DOWNLOAD_NEW:
                                case Node.prototype.COMMAND.DOWNLOAD_ALL:
                                case Node.prototype.COMMAND.DOWNLOAD_MULTIPLE:

                                    self.nodeInstance.deviceProfile_ANTFS.sendDownloadRequest.call(self,
                                            DeviceProfile_ANTFS.prototype.RESERVED_FILE_INDEX.DIRECTORY_STRUCTURE, 0,
                                            DeviceProfile_ANTFS.prototype.INITIAL_DOWNLOAD_REQUEST.NEW_TRANSFER, 0, 0,
                                            function completeCB() {
                                                // var self = this;
                                                var genericIndex;

                                                self.nodeInstance.deviceProfile_ANTFS.parseDirectory.call(self, self.deviceProfile.response.downloadFile);

                                                
                                                if (currentCommand === Node.prototype.COMMAND.DOWNLOAD_NEW)
                                                    genericIndex = self.deviceProfile.directory.newIndex;
                                                else if (currentCommand === Node.prototype.COMMAND.DOWNLOAD_ALL)
                                                    genericIndex = self.deviceProfile.directory.downloadIndex;
                                                else if (currentCommand === Node.prototype.COMMAND.DOWNLOAD_MULTIPLE) {

                                                    genericIndex = self.nodeInstance.commandIndex[0];
                                                    console.log("genericIndex", genericIndex);
                                                }

                                                if (genericIndex.length > 0) {
                                                    self.deviceProfile.downloadMultipleFiles.call(self, genericIndex, function complete() {
                                                        //console.log(Date.now() + " Downloaded new files");
                                                        delete self.deviceProfile.processingCommand; // Allow processing of next command
                                                    });

                                                } else {
                                                    console.log(Date.now() + " No files available for download");
                                                    delete self.deviceProfile.processingCommand; // Allow processing of next command
                                                }
                                            });

                                    break;

                                case Node.prototype.COMMAND.ERASE_MULTIPLE:

                                    var genericIndex;

                                    genericIndex = self.nodeInstance.commandIndex[0];

                                    if (genericIndex.length > 0) {
                                        // Index position only valid for one request -> erase of one file updates index of other files -> not easy to delete multiple files in one operation -> only delete ONE file pr. operation
                                        self.deviceProfile.eraseMultipleFiles.call(self, [genericIndex[0]], function complete() {
                                            self.nodeInstance.deviceProfile_ANTFS.sendDownloadRequest.call(self,
                                           DeviceProfile_ANTFS.prototype.RESERVED_FILE_INDEX.DIRECTORY_STRUCTURE, 0,
                                           DeviceProfile_ANTFS.prototype.INITIAL_DOWNLOAD_REQUEST.NEW_TRANSFER, 0, 0,
                                           function completeCB() {
                                               // var self = this;

                                               self.nodeInstance.deviceProfile_ANTFS.parseDirectory.call(self, self.deviceProfile.response.downloadFile);

                                               delete self.deviceProfile.processingCommand;
                                           })
                                        });
                                    } else
                                        {
                                          console.log(Date.now() + " No files to erase");
                                           delete self.deviceProfile.processingCommand; // Allow processing of next command
                                    }

                                    break;

                                default:
                                    console.log(Date.now() + " Unknown command to process " + self.nodeInstance.commandQueue);
                                    delete self.deviceProfile.processingCommand;
                                    break;
                            }
                    }
                    //else
                    //    console.log(Date.now() + " Nothing to do in transport layer ", self.deviceProfile.download);

                    break;
            }
        }
    }
};

function DeviceProfile_SPDCAD() {
    DeviceProfile.call(this); // Call parent
}

DeviceProfile_SPDCAD.protype = DeviceProfile.prototype;  // Inherit properties/methods

DeviceProfile_SPDCAD.constructor = DeviceProfile_SPDCAD;  // Update constructor

DeviceProfile_SPDCAD.prototype = {

    DEVICE_TYPE: 0x79, // 121
    CHANNEL_PERIOD: 8086,

    getSlaveChannelConfiguration: function (networkNr, channelNr, deviceNr, transmissionType, searchTimeout) {

        var channel = new Channel(channelNr, Channel.prototype.CHANNEL_TYPE.receive_channel, networkNr, Network.prototype.NETWORK_KEY.ANT);

        channel.setChannelId(deviceNr, DeviceProfile_SPDCAD.prototype.DEVICE_TYPE, transmissionType, false);
        channel.setChannelPeriod(DeviceProfile_SPDCAD.prototype.CHANNEL_PERIOD); // ca. 4.05 Hz
        channel.setChannelSearchTimeout(searchTimeout);
        channel.setChannelFrequency(ANT.prototype.ANT_FREQUENCY);

        channel.nodeInstance = this.nodeInstance; // Attach channel to nodeInstance
        channel.deviceProfile = this; // Attach deviceprofile to channel
        this.channel = channel; // Attach channel to device profile

        channel.channelResponseEvent = this.channelResponseEvent || DeviceProfile.prototype.channelResponseEvent;
        channel.broadCastDataParser = this.broadCastDataParser || DeviceProfile.prototype.broadCastDataParser;

        return channel;

    },

    broadCastDataParser: function (data) {
        console.log(Date.now() + " SPDCAD broad cast data ", data);
    }
};

function Node() {
  

    console.log("ANTFSNODE version ", Node.prototype.VERSION);

    var self = this;
    self.commandQueue = [];
    self.commandIndex = [];

    //if (process.argv.length <= 2) {
    //    showUsage();
    //    return;
    //}

    function parseIndex(indexArg) {

        var parsed = indexArg.split(',').map(function (value, index, arr) {
            var range = value.split('-'), low, high, arr = [], v;
            if (range.length === 2) {
                low = parseInt(range[0]);
                high = parseInt(range[1])

                if (low < high)
                    for (var nr = low; nr <= high; nr++)
                        arr.push(nr);

                return arr;
            } else

                v = parseInt(value, 10); if (v !== NaN) return v;
        }),
        elementNr, rangeArr, rangeElementNr, indexArr = [] ;

        console.log("Parsed", parsed);

        for (elementNr = 0; elementNr < parsed.length; elementNr++)
            if (typeof parsed[elementNr] === 'object') // Process range
            {
                rangeArr = parsed[elementNr];
                for (rangeElementNr=0;rangeElementNr<rangeArr.length;rangeElementNr++)
                    if (typeof rangeArr[rangeElementNr] === 'number')
                        indexArr.push(rangeArr[rangeElementNr]);
            }
            else if (typeof parsed[elementNr] === 'number')
                indexArr.push(parsed[elementNr])

        console.log("Index arr",indexArr);

        return indexArr;
    }

    Node.prototype.STARTUP_DIRECTORY = process.argv[1].slice(0, process.argv[1].lastIndexOf('\\'));
    console.log("Startup directory :", Node.prototype.STARTUP_DIRECTORY);

    console.log("argv", process.argv);

    if (process.argv[2] === "-d" || process.argv[2] === "--download") {
        if (typeof process.argv[3] === "undefined")
            self.commandQueue.push(Node.prototype.COMMAND.DOWNLOAD_NEW);
        else if (process.argv[3] === "*")
            self.commandQueue.push(Node.prototype.COMMAND.DOWNLOAD_ALL);
        else {
            self.commandQueue.push(Node.prototype.COMMAND.DOWNLOAD_MULTIPLE); // i.e '1,2,3'
            //argNr = 3;
            self.commandIndex.push(parseIndex(process.argv[3]));
        }


    } else if (process.argv[2] === "-e" || process.argv[2] === "--erase") {
        self.commandQueue.push(Node.prototype.COMMAND.ERASE_MULTIPLE);
        if (typeof process.argv[3] === "undefined") {
            console.log("Missing file index/range");
            showUsage();
            return;
        } else
            self.commandIndex.push(parseIndex(process.argv[3]));

    }
    //else {
    //    showUsage();
    //    return;
    //}

    function showUsage() {
        console.log("Commands :");
        console.log("   -d, --download - download new files from device");
        console.log("   -d n - download file at index n");
        console.log("   -d 'n1,n2,n3-n4' -download file at index n1 and n2 and n3 to n4")
        console.log("   -d * - download all readable files");
        console.log("   -e, --erase  n1 - erase file at index n1");
    }

    // var idVendor = 4047, idProduct = 4104; // Garmin USB2 Wireless ANT+
    this.ANT = new ANT(4047, 4104,this);

    this.deviceProfile_HRM = new DeviceProfile_HRM(this);
    this.deviceProfile_SDM = new DeviceProfile_SDM(this);
    this.deviceProfile_ANTFS = new DeviceProfile_ANTFS(this);
    this.deviceProfile_SPDCAD = new DeviceProfile_SPDCAD(this);

    function success() {
        self.start();
    }

    function error() {
        self.stop();
    }

    self.ANT.init(error, success);
}

Node.prototype = {

    VERSION: "0.1",

    WEBSOCKET_HOST: 'localhost',
    WEBSOCKET_PORT: 8093,

    COMMAND: {
        DOWNLOAD_MULTIPLE : 0x03,
        DOWNLOAD_ALL: 0x02,
        DOWNLOAD_NEW: 0x00,
        ERASE_MULTIPLE: 0x01,
    },

    broadCast:  // Broadcast data to all clients
     function (data) {
         var self = this;

         if (typeof self.wss === "undefined") {
             console.warn("Cannot broadcast data, no websocket server available");
             return;
         }

         var len = self.wss.clients.length;
         //console.log("Length of clients", len);
         for (var clientNr = 0; clientNr < len; clientNr++) {
             if (typeof self.wss.clients !== "undefined" && self.wss.clients[clientNr] !== "undefined") // Just to make sure we have clientTracking and client is present
             {
                 //console.log("Sending data to client nr. ", clientNr, "data:",data);
                 self.wss.clients[clientNr].send(data);
             } else
                 console.warn("Found no clients to send data to, is websocket server operative?");
         }
     },

    stop: function () {
        var self = this;
        clearInterval(self.heartBeatIntervalID);
    },

    beat: function ()  // When we have nothing more important to do ...
    {
        var self = this;
        self.heartBeat++;
    },

    start: function () {
       // console.log(process);
        var self = this;

        self.heartBeat = 0;
        self.heartBeatIntervalID = setInterval(self.beat, 60000 * 60 * 24); // 1 "beat" each day 


        // Handle gracefull termination
        // http://thomashunter.name/blog/gracefully-kill-node-js-app-from-ctrl-c/

        process.on('SIGINT', function sigint() {
            // console.log("\nSignal interrut event SIGINT (Ctrl+C)");

            // TO DO:  self.deviceProfile_ANTFS.sendDisconnect.call(self); // Disconnect

            self.stop();

            if (typeof self.wss !== "undefined") {
                console.log("Closing websocket server, terminating connections to clients");
                self.wss.close();
            }
            self.ANT.exit();
        });

        // Channel configurations indexed by channel nr.

        self.ANT.channelConfiguration[0] = self.deviceProfile_HRM.getSlaveChannelConfiguration(Network.prototype.ANT, 0, 0, 0, ANT.prototype.INFINITE_SEARCH);
        self.ANT.channelConfiguration[1] = self.deviceProfile_ANTFS.getSlaveChannelConfiguration(Network.prototype.ANT_FS, 1, 0, 0, 0);
        self.ANT.channelConfiguration[2] = self.deviceProfile_SDM.getSlaveChannelConfiguration(Network.prototype.ANT, 2, 0, 0, ANT.prototype.INFINITE_SEARCH);
        self.ANT.channelConfiguration[3] = self.deviceProfile_SPDCAD.getSlaveChannelConfiguration(Network.prototype.ANT, 3, 0, 0, ANT.prototype.INFINITE_SEARCH);

        // Lesson : ANT-FS and HRM on different network due to different keys
        // Seems like : Cannot simultaneously listen to broadcasts from ANT-FS =  2450 MHz and HRM/Bike spd/Stride sensor = 2457 Mhz, but with different msg. periode

        self.ANT.configure(0, function () { console.log("Could not configure device profile HRM"); }, function () {
            console.log("Configuration of device profile HRM channel OK");
            self.ANT.configure(1, function () { console.log("Could not configure device profile ANT-FS"); }, function () {
                console.log("Configuration of device profile ANT-FS OK");
                self.ANT.configure(3, function () { console.log("Could not configure device profile SPDCAD"); }, function () {
                    //console.log("Configuration of device profile SDM OK");
                    self.ANT.configure(2, function () { console.log("Could not configure device profile SDM"); }, function () {
                        //console.log("Configuration of device profile SDM OK");
                        //self.ANT.open(0, function () { console.log("Could not open channel for HRM"); }, function () {
                        //    console.log("Open channel for HRM");
                        //self.ANT.open(2, function error() { console.log("Could not open channel for SDM"); }, function success() {
                        //     console.log(Date.now()+ " Open channel for SDM");
                        //console.log(self.ANT.channelConfiguration);
                        self.ANT.open(1, function () { console.log("Could not open channel for ANT-FS"); }, function () {
                            console.log(Date.now() + " ANT-FS channel OPEN");
                            self.ANT.listen.call(self.ANT, function transferCancelCB() { self.ANT.iterateChannelStatus(0, true, function clean() { self.ANT.tryCleaningBuffers(function release() { self.ANT.releaseInterfaceCloseDevice(); }); }); });
                        });
                        //  });
                        //})
                    });
                });
            });
        });

        // Start websocket server

        var WebSocketServer = require('ws').Server;

        // Client tracking keeps track of websocket server clients in "clients" property -> removed on 'close'
        self.wss = new WebSocketServer({ host: Node.prototype.WEBSOCKET_HOST, port: Node.prototype.WEBSOCKET_PORT, clientTracking: true });

        self.wss.on('listening', function () {
            console.log("WebsocketServer: listening on " + Node.prototype.WEBSOCKET_HOST + ":" + Node.prototype.WEBSOCKET_PORT);
        });

        self.wss.on('connection', function (ws) {
            console.log(Date.now() + " WebsocketServer: New client connected - will receive broadcast data");
            // console.log(ws);
            //self.websockets.push(ws); // Keeps track of all incoming websocket clients

            ws.on('message', function (message) {
                console.log(Date.now() + ' Received: %s', message);
                //    ws.send('something');
            });
        });

        self.wss.on('error', function (error) {
            console.log(Date.now() + "WebsocketServer: Error ", error);
        });


    },

};

function Network(nr, key) {
    var self = this;
    this.number = nr;
    if (typeof key === "string") // Filename
       this.key = this.getNetworkKey(key);
    else
        this.key = key;
}



Network.prototype = {
    NETWORK_KEY: {
        ANTFS: "ANT-FS.BIN",
        ANT: "ANT-PLUS.BIN" // ANT+ managed network key filename , i.e HRM device profile 
    },
    ANT: 0,      // Separate networks due to different keys
    ANT_FS: 1,

    getNetworkKey: function (fileName, completeCB) {
        //fs.readFile(DeviceProfile_ANTFS.prototype.ROOT_DIR + '\\'+fileName, function (err, networkKey) {
        //    if (err) throw err;

        //    if (typeof completeCB === "function")
        //        completeCB(networkKey);
        //    else
        //        console.log(Date.now() + " No completion callback specified");
        //});
        // Only 8 bytes -> sync operation
        var fullFileName = Node.prototype.STARTUP_DIRECTORY + '\\' + fileName;

        if (typeof Network.prototype.keyCache === "undefined")
            Network.prototype.keyCache = {};

        if (typeof Network.prototype.keyCache[fileName] === "undefined") {
            //console.log("Getting key from file ", fullFileName);
            Network.prototype.keyCache[fileName] = fs.readFileSync(fullFileName);
        }
        //else
        //    console.log("Fetcing key from keycache filename:", fileName, " cached key", Network.prototype.keyCache[fileName]);

        return Network.prototype.keyCache[fileName];
    }
};

function Channel(channelNr, channelType, networkNr, networkKey) {
    //this.host = host;
    this.number = channelNr;
    this.channelType = channelType;
    this.network = new Network(networkNr, networkKey);
    //this.ANTEngine = new ANT(host, this);
}

util.inherits(Channel, events.EventEmitter);

Channel.prototype.CHANNEL_TYPE = {
    // Bidirectional
    0x00: "Bidirectional Slave Channel",
    receive_channel: 0x00, // slave
    0x10: "Bidirectional Master Channel",
    transmit_channel: 0x10, // master
    // Unidirectional
    0x50: "Master Transmit Only Channel (legacy)",
    transmit_only_channel: 0x50,
    0x40: "Slave Receive Only Channel (diagnostic)",
    receive_only_channel: 0x40,
    // Shared channels
    0x20: "Shared bidirectional Slave channel",
    shared_bidirectional_receive_channel: 0x20,
    0x30: "Shared bidirectional Master channel",
    shared_bidirectional_transmit_channel: 0x30
};

Channel.prototype.setChannelId = function (usDeviceNum, ucDeviceType, ucTransmissionType, pairing) {
    if (typeof usDeviceNum === "undefined" || typeof ucDeviceType === "undefined" || typeof ucTransmissionType === "undefined")
        console.error("Undefined parameters ", usDeviceNum, ucDeviceType, ucTransmissionType);

    this.deviceNumber = usDeviceNum; // 16-bit
    this.deviceType = ucDeviceType; // i.e HRM = 0x78 = 120 dec. 8-bit ANTWare 0 - 127, 0 = wildcard, 7-bit pairing
    if (pairing)
        this.deviceType = ucDeviceType | 0x80; // Set bit 7 high;
    this.transmissionType = ucTransmissionType;
},

Channel.prototype.setChannelPeriod = function (usMessagePeriod) {
    var rate;
    this.period = usMessagePeriod;

    switch (usMessagePeriod) {
        case 65535: rate = "0.5 Hz (65535)"; break;
        case 32768: rate = "1 Hz (32768)"; break;
        case 16384: rate = "2 Hz (16384)"; break;
        case 8192: rate = "4 Hz (8192)"; break;
        case 8070: rate = (32768 / 8070).toFixed(2) + " Hz (8070)"; break; // HRM
        case 4096: rate = "8 Hz (4096)"; break;
        default: rate = usMessagePeriod + " " + (32768 / usMessagePeriod).toFixed(2) + " Hz"; break;
    }

    this.periodFriendly = rate;
};

Channel.prototype.setChannelSearchTimeout = function (ucSearchTimeout) {
    var friendlyFormat;

    this.searchTimeout = ucSearchTimeout;

    switch (ucSearchTimeout) {
        case 0:
            friendlyFormat = "Setting search timeout for channel " + this.number + " to " + ucSearchTimeout + " = Disable high priority searcg mode";
            break;
        case 255:
            friendlyFormat = "Setting search timeout for channel " + this.number + " to " + ucSearchTimeout + " = Infinite search";
            break;
        default:
            friendlyFormat = "Setting search timeout for channel " + this.number + " to " + ucSearchTimeout + " = " + ucSearchTimeout * 2.5 + "sec.";
            break;
    }

    this.searchTimeoutFriendly = friendlyFormat;
};

Channel.prototype.setChannelFrequency = function (ucRFFreq) {
    var freq = 2400 + ucRFFreq, friendlyFormat;

    friendlyFormat = "Setting RF frequency to " + freq + " MHz";

    this.RFfrequency = ucRFFreq;
    this.RFfrequencyFriendly = friendlyFormat;
};

Channel.prototype.setChannelSearchWaveform = function (waveform) {
    this.searchWaveform = waveform;
};


// Based on ANT-FS PCTOOLS Source Code
// http://www.thisisant.com/developer/ant/licensing/ant-shared-source-license

function CRC() {
}

CRC.prototype = {

    CRC_Calc16: function (data) {
        return this.CRC_UpdateCRC16(0, data);
    },

    CRC_UpdateCRC16: function (CRCSeed, data) {
        var byteNr, len = data.length;
        for (byteNr = 0; byteNr < len; byteNr++)
            CRCSeed = this.CRC_Get16(CRCSeed, data[byteNr]);
        return CRCSeed;
    },

    CRC_Get16: function (CRCSeed, aByte) {
        var CRC16Table = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
                0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400],
            usTemp;

        // compute checksum of lower four bits of byte 
        usTemp = CRC16Table[CRCSeed & 0xF];
        CRCSeed = (CRCSeed >> 4) & 0x0FFF;
        CRCSeed = CRCSeed ^ usTemp ^ CRC16Table[aByte & 0x0F];

        // now compute checksum of upper four bits of byte 
        usTemp = CRC16Table[CRCSeed & 0xF];
        CRCSeed = (CRCSeed >> 4) & 0x0FFF;
        CRCSeed = CRCSeed ^ usTemp ^ CRC16Table[(aByte >> 4) & 0x0F];

        return CRCSeed;

    }
};

var ANTNode = new Node(); // Let's start ANT node