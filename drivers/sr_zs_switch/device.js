'use strict';

const { CLUSTER } = require('zigbee-clusters');
const { Cluster } = require('zigbee-clusters');
const TuyaSpecificCluster = require('../../lib/TuyaSpecificCluster');
const TuyaSpecificClusterDevice = require("../../lib/TuyaSpecificClusterDevice");

// Constants for frame types
const FRAME_TYPES = {
    ATTRIBUTE_REPORT: 24,
    SWITCH_EVENT: 8,
    SCENE_EVENT: 1
};

const SWITCH_CONFIG = {
    FIRST_SWITCH_ID: 1,
    LAST_SWITCH_ID: 3,
    DEBOUNCE_TIME_MS: 900
};

class SRZSSwitch extends TuyaSpecificClusterDevice {
    
    /**
     * Initialize the device
     * @param {Object} params - Initialization parameters
     * @param {Object} params.zclNode - ZCL node object
     */
    async onNodeInit({ zclNode }) {
        await this.initializeDevice(zclNode);
        await this.registerCapabilities(zclNode);
        await this.registerActions();
        await this.setupFrameHandler();
    }

    /**
     * Initialize device configuration and settings
     * @param {Object} zclNode - ZCL node object
     */
    async initializeDevice(zclNode) {
        this.printNode();
        await this.magicallyConfigureTuyaSeparateOnoffSwitchingOnEndpoints(zclNode);
        this.lastFrameTime = {};
        this.debounceTime = SWITCH_CONFIG.DEBOUNCE_TIME_MS;
    }

    /**
     * Register capability listeners for each endpoint
     * @param {Object} zclNode - ZCL node object
     */
    async registerCapabilities(zclNode) {
        for (let switchId = SWITCH_CONFIG.FIRST_SWITCH_ID; switchId <= SWITCH_CONFIG.LAST_SWITCH_ID; switchId++) {
            this.registerCapabilityListener(`onoff_${switchId}`, async (value) => {
                return await this.handleOnOffCapability(zclNode, switchId, value);
            });
        }
    }

    /**
     * Handle on/off capability changes
     * @param {Object} zclNode - ZCL node object
     * @param {number} endpoint - Endpoint number
     * @param {boolean} value - On/off value
     * @returns {Promise<boolean>} Success status
     */
    async handleOnOffCapability(zclNode, endpoint, value) {
        if (!this.isValidEndpoint(endpoint)) {
            this.error(`Invalid endpoint: ${endpoint}`);
            return false;
        }

        try {
            const cluster = zclNode.endpoints[endpoint].clusters.onOff;
            await (value ? cluster.setOn() : cluster.setOff());
            return true;
        } catch (error) {
            this.error(`Error setting onoff_${endpoint}:`, error);
            return false;
        }
    }

    /**
     * Register action cards for each endpoint
     */
    async registerActions() {
        for (let switchId = SWITCH_CONFIG.FIRST_SWITCH_ID; switchId <= SWITCH_CONFIG.LAST_SWITCH_ID; switchId++) {
            registerSetOnOffAction.call(this, `set_onoff_${switchId}_true`, switchId, true);
            registerSetOnOffAction.call(this, `set_onoff_${switchId}_false`, switchId, false);
        }
    }

    /**
     * Setup frame handler for device events
     */
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

    /**
     * Handle on/off frame events
     * @param {number} endpointId - Endpoint ID
     * @param {Object} frame - Frame data
     * @param {Object} meta - Meta information
     */
    handleOnOffFrame(endpointId, frame, meta) {
        this.log("Handling onoff frame:", endpointId, frame.toJSON(), meta);
        const frameData = frame.toJSON();
        const firstByte = frameData.data[0];
        const currentTime = Date.now();

        switch(firstByte) {
            case FRAME_TYPES.ATTRIBUTE_REPORT:
                this.log("Ignoring attribute report onoff/scene frame", endpointId, frameData, meta);
                break;
            case FRAME_TYPES.SWITCH_EVENT:
                this.handleSwitchFrame(endpointId, frameData, currentTime, meta);
                break;
            case FRAME_TYPES.SCENE_EVENT:
                this.handleSceneFrame(endpointId, currentTime, meta);
                break;
            default:
                this.error("Unexpected onoff/scene frame type:", endpointId, frameData, meta);
        }
    }

    /**
     * Handle switch frame events
     * @param {number} endpointId - Endpoint ID
     * @param {Object} frameData - Frame data
     * @param {number} currentTime - Current timestamp
     * @param {Object} meta - Meta information
     */
    handleSwitchFrame(endpointId, frameData, currentTime, meta) {
        if (!this.isValidEndpoint(endpointId)) {
            this.error("Unexpected endpoint for onoff frame:", endpointId, frameData, meta);
            return;
        }

        this.log("Handling switch frame:", endpointId, frameData, meta);
        const value = frameData.data[6] === 1;
        const frameKey = `${endpointId}-${FRAME_TYPES.SWITCH_EVENT}-${value}`;

        if (this.isDebounced(frameKey, currentTime)) return;
        this.lastFrameTime[frameKey] = currentTime;

        this.updateSwitchState(endpointId, value);
    }

    /**
     * Handle scene frame events
     * @param {number} endpointId - Endpoint ID
     * @param {number} currentTime - Current timestamp
     * @param {Object} meta - Meta information
     */
    handleSceneFrame(endpointId, currentTime, meta) {
        const frameKey = `${endpointId}-${FRAME_TYPES.SCENE_EVENT}-scene`;

        if (!this.isDebounced(frameKey, currentTime)) {
            this.lastFrameTime[frameKey] = currentTime;
            this.triggerSceneFlow(endpointId);
        }
    }

    /**
     * Check if frame should be debounced
     * @param {string} frameKey - Frame identifier
     * @param {number} currentTime - Current timestamp
     * @returns {boolean} True if frame should be debounced
     */
    isDebounced(frameKey, currentTime) {
        if (this.lastFrameTime[frameKey] && 
            (currentTime - this.lastFrameTime[frameKey]) < this.debounceTime) {
            this.log('Debouncing frame:', frameKey);
            return true;
        }
        return false;
    }

    /**
     * Validate endpoint number
     * @param {number} endpoint - Endpoint number to validate
     * @returns {boolean} True if endpoint is valid
     */
    isValidEndpoint(endpoint) {
        return endpoint >= SWITCH_CONFIG.FIRST_SWITCH_ID && 
               endpoint <= SWITCH_CONFIG.LAST_SWITCH_ID;
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
