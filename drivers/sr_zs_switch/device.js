'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class SRZSSwitch extends ZigBeeDevice {

    async onNodeInit({ zclNode }) {
        this.printNode();

        // Konfiguracja attribute reporting dla wszystkich endpointów
        for (let i = 1; i <= 6; i++) {
            await this.configureAttributeReporting([
                {
                    endpointId: i,
                    cluster: CLUSTER.ON_OFF,
                    attributeName: 'onOff',
                    minInterval: 0,
                    maxInterval: 60,
                    minChange: 1
                }
            ]);
        }

        // Rejestracja listenerów dla capabilities
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

        // Rejestracja akcji dla przełączników
        registerSetOnOffAction.call(this, 'set_onoff_1_true', 1, true);
        registerSetOnOffAction.call(this, 'set_onoff_1_false', 1, false);
        registerSetOnOffAction.call(this, 'set_onoff_2_true', 2, true);
        registerSetOnOffAction.call(this, 'set_onoff_2_false', 2, false);
        registerSetOnOffAction.call(this, 'set_onoff_3_true', 3, true);
        registerSetOnOffAction.call(this, 'set_onoff_3_false', 3, false);

        const node = await this.homey.zigbee.getNode(this);
        this.log("Registering frame handler");
        node.handleFrame = (endpointId, clusterId, frame, meta) => {
            const frameData = frame.toJSON();
            this.log("Received frame:", endpointId, clusterId, frameData, meta);

            if (clusterId === CLUSTER.ON_OFF.ID) {
                // Sprawdź czy to raport atrybutu czy zmiana stanu
                if (frameData.data[0] === 24) {  // 24 (0x18) to marker attribute report
                    // To jest raport atrybutu - ignoruj
                    this.log("Ignoring attribute report");
                    return;
                }

                this.log("OnOff frame:", endpointId, clusterId, frameData, meta);

                if (endpointId >= 1 && endpointId <= 3) {
                    // Obsługa przełączników
                    const value = frameData.data[6] === 1;  // ostatni bajt to stan
                    
                    // Aktualizuj stan capability
                    this.log("setting capability value on endpoint", endpointId, value);
                    this.setCapabilityValue(`onoff_${endpointId}`, value)
                        .catch(err => this.error(`Error setting capability value for onoff_${endpointId}:`, err));

                    // Wyzwól trigger
                    this.log(`triggering onoff_${endpointId}_${value ? 'true' : 'false'}`);
                    const triggerCard = this.homey.flow.getDeviceTriggerCard(`onoff_${endpointId}_${value ? 'true' : 'false'}`);
                    triggerCard.trigger(this)
                        .catch(err => this.error(`Error triggering onoff_${endpointId}_${value}:`, err));
                } else if (endpointId >= 4 && endpointId <= 6) {
                    // Obsługa scen - format ramki jest inny
                    this.log(`triggering scene_${endpointId}_triggered`);
                    const triggerCard = this.homey.flow.getDeviceTriggerCard(`scene_${endpointId}_triggered`);
                    triggerCard.trigger(this, {
                        scene: endpointId,
                        scene_name: `Scene ${endpointId}`
                    })
                    .catch(err => this.error(`Error triggering scene ${endpointId}:`, err));
                }
            }
        };
        this.log("Frame handler registered");
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

// Funkcja rejestrująca akcję włączania/wyłączania dla danego endpointu
function registerSetOnOffAction(cardName, endpointId, state) {
    const actionCard = this.homey.flow.getActionCard(cardName);
    actionCard.registerRunListener(async (args) => {
        this.log(`Executing action ${cardName}`);
        try {
            if(state) {
                await this.zclNode.endpoints[endpointId].clusters.onOff.setOn();  // Włącz
            } else {
                await this.zclNode.endpoints[endpointId].clusters.onOff.setOff(); // Wyłącz
            }
            return true;
        } catch (error) {
            this.error(`Error executing ${cardName}`, error);
            return false; // Zwracamy false, gdy wystąpi błąd
        }
    });
}

module.exports = SRZSSwitch;
