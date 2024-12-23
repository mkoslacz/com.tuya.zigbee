'use strict';

const { CLUSTER } = require('zigbee-clusters');
const { Cluster } = require('zigbee-clusters');
const TuyaSpecificCluster = require('../../lib/TuyaSpecificCluster');
const TuyaSpecificClusterDevice = require("../../lib/TuyaSpecificClusterDevice");
Cluster.addCluster(TuyaSpecificCluster);

class SRZSSwitch extends TuyaSpecificClusterDevice {

    async onNodeInit({ zclNode }) {
        this.printNode();

        // Register listeners for capabilities
        for (let i = 1; i <= 3; i++) {
            this.registerCapabilityListener(`onoff_${i}`, async (value) => {
                try {
                    if (value) {
                        await zclNode.endpoints[i].clusters.onOff.setOn();
                    } else {
                        await zclNode.endpoints[i].clusters.onOff.setOff();
                    }
                    return true;
                } catch (error) {
                    this.error(`Error setting onoff_${i}:`, error);
                    return false;
                }
            });
        }

        await this.magicallyConfigureTuyaSeparateOnoffSwitchingOnEndpoints(zclNode);

        // Register actions for switches
        registerSetOnOffAction.call(this, 'set_onoff_1_true', 1, true);
        registerSetOnOffAction.call(this, 'set_onoff_1_false', 1, false);
        registerSetOnOffAction.call(this, 'set_onoff_2_true', 2, true);
        registerSetOnOffAction.call(this, 'set_onoff_2_false', 2, false);
        registerSetOnOffAction.call(this, 'set_onoff_3_true', 3, true);
        registerSetOnOffAction.call(this, 'set_onoff_3_false', 3, false);

        const node = await this.homey.zigbee.getNode(this);
        this.log("Registering frame handler");

        // Add variables for debounce
        this.lastFrameTime = {};
        this.debounceTime = 900; // 900ms - covers burst events (~800ms) with margin

        node.handleFrame = (endpointId, clusterId, frame, meta) => {
            const frameData = frame.toJSON();
            if (clusterId === CLUSTER.ON_OFF.ID) {
                const firstByte = frameData.data[0];
                const currentTime = Date.now();

                if (firstByte === 24) {
                    this.log("Ignoring attribute report onoff/scene frame", endpointId, clusterId, frameData, meta);
                    return;
                } else if (firstByte === 8) {
                    const value = frameData.data[6] === 1;
                    const frameKey = `${endpointId}-${firstByte}-${value}`; // Add on/off value to the key

                    // Check if debounce time has passed
                    if (this.lastFrameTime[frameKey] &&
                        (currentTime - this.lastFrameTime[frameKey]) < this.debounceTime) {
                        this.log('Debouncing frame:', frameKey);
                        return;
                    }

                    // Update last frame time
                    this.lastFrameTime[frameKey] = currentTime;

                    if (endpointId >= 1 && endpointId <= 3) {
                        // Update capability state
                        this.log("setting capability value on endpoint", endpointId, value);
                        this.setCapabilityValue(`onoff_${endpointId}`, value)
                            .catch(err => this.error(`Error setting capability value for onoff_${endpointId}:`, err));

                        // Trigger flow card
                        this.log(`triggering onoff_${endpointId}_${value ? 'true' : 'false'}`);
                        const triggerCard = this.homey.flow.getDeviceTriggerCard(`onoff_${endpointId}_${value ? 'true' : 'false'}`);
                        triggerCard.trigger(this)
                            .catch(err => this.error(`Error triggering onoff_${endpointId}_${value}:`, err));
                    } else { this.error("Unexpected endpoint for onoff frame:", endpointId, clusterId, frameData, meta)}
                } else if (firstByte === 1) {
                    const frameKey = `${endpointId}-${firstByte}-scene`; // For scenes add suffix

                    // Check if debounce time has passed
                    if (this.lastFrameTime[frameKey] &&
                        (currentTime - this.lastFrameTime[frameKey]) < this.debounceTime) {
                        this.log('Debouncing frame:', frameKey);
                        return;
                    }

                    // Update last frame time
                    this.lastFrameTime[frameKey] = currentTime;

                    this.log("Received scene frame:", endpointId, clusterId, frameData, meta);
                    // Handle scenes for all endpoints
                    this.log(`triggering scene_${endpointId}_triggered`);
                    const triggerCard = this.homey.flow.getDeviceTriggerCard(`scene_${endpointId}_triggered`);
                    triggerCard.trigger(this, {
                        scene: endpointId,
                        scene_name: `Scene ${endpointId}`
                    })
                    .catch(err => this.error(`Error triggering scene ${endpointId}:`, err));
                } else { this.error("Unexpected onoff/scene frame type:", endpointId, clusterId, frameData, meta)}
            } else { this.log("Received not an onoff/scene frame:", endpointId, clusterId, frameData, meta)}

        };
        this.log("Frame handler registered");
    }
    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log('Settings were changed (string mode): ', newSettings);
        for (const key of changedKeys) {
            if (key.startsWith('mode_')) {
                const modeNumber = parseInt(key.slice(-1));
                const dpId = 17 + modeNumber; // mode_1 = dp 18, mode_2 = dp 19, mode_3 = dp 20

                try {
                    await this.writeEnum(dpId, newSettings[key].includes('scene') ? 1 : 0);
                    this.log(`Successfully set ${key} to ${newSettings[key]}`);
                } catch (err) {
                    this.error(`Failed to set ${key}:`, err);
                    throw err;
                }
            }
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

// Function registering on/off action for given endpoint
function registerSetOnOffAction(cardName, endpointId, state) {
    const actionCard = this.homey.flow.getActionCard(cardName);
    actionCard.registerRunListener(async (args) => {
        this.log(`Executing action ${cardName}`);
        try {
            if(state) {
                await this.zclNode.endpoints[endpointId].clusters.onOff.setOn();  // Turn On
            } else {
                await this.zclNode.endpoints[endpointId].clusters.onOff.setOff(); // Turn Off
            }
            return true;
        } catch (error) {
            this.error(`Error executing ${cardName}`, error);
            return false; // Return false when error occurs
        }
    });
}

module.exports = SRZSSwitch;
