'use strict';

const { CLUSTER } = require('zigbee-clusters');
const { Cluster } = require('zigbee-clusters');
const TuyaSpecificCluster = require('../../lib/TuyaSpecificCluster');
const TuyaSpecificClusterDevice = require("../../lib/TuyaSpecificClusterDevice");
Cluster.addCluster(TuyaSpecificCluster);

class SRZSSwitch extends TuyaSpecificClusterDevice {
    
    async onNodeInit({ zclNode }) {
        await this.initializeDevice(zclNode);
        await this.registerCapabilities(zclNode);
        await this.registerActions();
        await this.setupFrameHandler();
    }

    async initializeDevice(zclNode) {
        this.printNode();
        await this.magicallyConfigureTuyaSeparateOnoffSwitchingOnEndpoints(zclNode);
        this.lastFrameTime = {};
        this.debounceTime = 900;
    }

    async registerCapabilities(zclNode) {
        for (let i = 1; i <= 3; i++) {
            this.registerCapabilityListener(`onoff_${i}`, async (value) => {
                return await this.handleOnOffCapability(zclNode, i, value);
            });
        }
    }

    async handleOnOffCapability(zclNode, endpoint, value) {
        try {
            const cluster = zclNode.endpoints[endpoint].clusters.onOff;
            await (value ? cluster.setOn() : cluster.setOff());
            return true;
        } catch (error) {
            this.error(`Error setting onoff_${endpoint}:`, error);
            return false;
        }
    }

    async registerActions() {
        for (let i = 1; i <= 3; i++) {
            registerSetOnOffAction.call(this, `set_onoff_${i}_true`, i, true);
            registerSetOnOffAction.call(this, `set_onoff_${i}_false`, i, false);
        }
    }

    async setupFrameHandler() {
        const node = await this.homey.zigbee.getNode(this);
        this.log("Registering frame handler");
        
        node.handleFrame = (endpointId, clusterId, frame, meta) => {
            if (clusterId !== CLUSTER.ON_OFF.ID) {
                this.log("Received not an onoff/scene frame:", endpointId, clusterId, frame.toJSON(), meta);
            } else {
                this.handleOnOffFrame(endpointId, frame, meta);
            }
        };
        this.log("Frame handler registered");
    }

    handleOnOffFrame(endpointId, frame, meta) {
        this.log("Handling onoff frame:", endpointId, frame.toJSON(), meta);
        const frameData = frame.toJSON();
        const firstByte = frameData.data[0];
        const currentTime = Date.now();

        switch(firstByte) {
            case 24:
                this.log("Ignoring attribute report onoff/scene frame", endpointId, frameData, meta);
                break;
            case 8:
                this.handleSwitchFrame(endpointId, frameData, currentTime, meta);
                break;
            case 1:
                this.handleSceneFrame(endpointId, currentTime, meta);
                break;
            default:
                this.error("Unexpected onoff/scene frame type:", endpointId, frameData, meta);
        }
    }

    handleSwitchFrame(endpointId, frameData, currentTime, meta) {
        this.log("Handling switch frame:", endpointId, frameData, meta);
        const value = frameData.data[6] === 1;
        const frameKey = `${endpointId}-8-${value}`;

        if (this.isDebounced(frameKey, currentTime)) return;
        this.lastFrameTime[frameKey] = currentTime;

        if (endpointId >= 1 && endpointId <= 3) {
            this.updateSwitchState(endpointId, value);
        } else {
            this.error("Unexpected endpoint for onoff frame:", endpointId, frameData, meta);
        }
    }

    handleSceneFrame(endpointId, currentTime, meta) {
        const frameKey = `${endpointId}-1-scene`;

        if (this.isDebounced(frameKey, currentTime) === false) {
            this.lastFrameTime[frameKey] = currentTime;
            this.triggerSceneFlow(endpointId);
        }
    }

    isDebounced(frameKey, currentTime) {
        if (this.lastFrameTime[frameKey] && 
            (currentTime - this.lastFrameTime[frameKey]) < this.debounceTime) {
            this.log('Debouncing frame:', frameKey);
            return true;
        }
        return false;
    }

    async updateSwitchState(endpointId, value) {
        this.log("setting capability value on endpoint", endpointId, value);
        await this.setCapabilityValue(`onoff_${endpointId}`, value)
            .catch(err => this.error(`Error setting capability value for onoff_${endpointId}:`, err));
        this.triggerSwitchFlow(endpointId, value);
    }

    async triggerSwitchFlow(endpointId, value) {
        this.log(`triggering onoff_${endpointId}_${value ? 'true' : 'false'}`);
        const triggerCard = this.homey.flow.getDeviceTriggerCard(`onoff_${endpointId}_${value ? 'true' : 'false'}`);
        await triggerCard.trigger(this)
            .catch(err => this.error(`Error triggering onoff_${endpointId}_${value}:`, err));
    }

    async triggerSceneFlow(endpointId) {
        this.log(`triggering scene_${endpointId}_triggered`);
        const triggerCard = this.homey.flow.getDeviceTriggerCard(`scene_${endpointId}_triggered`);
        await triggerCard.trigger(this, {
            scene: endpointId,
            scene_name: `Scene ${endpointId}`
        })
        .catch(err => this.error(`Error triggering scene ${endpointId}:`, err));
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log('Settings were changed (string mode): ', newSettings);
        for (const key of changedKeys) {
            if (key.startsWith('mode_')) {
                await this.updateModeSetting(key, newSettings);
            }
        }
    }

    // TODO: this is not working as expected. Logs as follows, does not throw an error but does not set the mode
    //     [Device:9c17a6f0-3c8a-4bc9-9616-74f447b0c1b0] Error writing Enum string to dp 19: Error: Timeout: Expected Response
    //     at Timeout._onTimeout (/app/node_modules/zigbee-clusters/lib/Cluster.js:966:16)
    //     at listOnTimeout (node:internal/timers:569:17)
    //     at process.processTimers (node:internal/timers:512:7)
    async updateModeSetting(key, newSettings) {
        const modeNumber = parseInt(key.slice(-1));
        const dpId = 17 + modeNumber;

        try {
            await this.writeEnum(dpId, newSettings[key].includes('scene') ? 1 : 0);
            this.log(`Successfully set ${key} to ${newSettings[key]}`);
        } catch (err) {
            this.error(`Failed to set ${key}:`, err);
            throw err;
        }
    }

    async magicallyConfigureTuyaSeparateOnoffSwitchingOnEndpoints(zclNode) {
        await zclNode.endpoints[1].clusters.basic.readAttributes([
            'manufacturerName',
            'zclVersion',
            'appVersion',
            'modelId',
            'powerSource',
            'attributeReportingStatus'
        ])
        .catch(err => {
            this.error('Error when reading device attributes ', err);
        });
    }
}

function registerSetOnOffAction(cardName, endpointId, state) {
    const actionCard = this.homey.flow.getActionCard(cardName);
    actionCard.registerRunListener(async () => {
        this.log(`Executing action ${cardName}`);
        try {
            const cluster = this.zclNode.endpoints[endpointId].clusters.onOff;
            await (state ? cluster.setOn() : cluster.setOff());
            return true;
        } catch (error) {
            this.error(`Error executing ${cardName}`, error);
            return false;
        }
    });
}

module.exports = SRZSSwitch;
