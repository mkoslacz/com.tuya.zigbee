'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class SRZSSwitch extends ZigBeeDevice {

    async onNodeInit({ zclNode }) {
        this.printNode();

        // // Konfiguracja attribute reporting dla wszystkich endpointów
        // for (let i = 1; i <= 6; i++) {
        //     await this.configureAttributeReporting([
        //         {
        //             endpointId: i,
        //             cluster: CLUSTER.ON_OFF,
        //             attributeName: 'onOff',
        //             minInterval: 0,
        //             maxInterval: 60,
        //             minChange: 1
        //         }
        //     ]);
        // }

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

        // Dodajemy zmienne dla debounce
        this.lastFrameTime = {};
        this.debounceTime = 900; // 900ms - pokryje burst zdarzeń (~800ms) z zapasem

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
                    const frameKey = `${endpointId}-${firstByte}-${value}`; // Dodajemy wartość on/off do klucza
                    
                    // Sprawdź czy minął czas debounce
                    if (this.lastFrameTime[frameKey] && 
                        (currentTime - this.lastFrameTime[frameKey]) < this.debounceTime) {
                        this.log('Debouncing frame:', frameKey);
                        return;
                    }
                    
                    // Aktualizuj czas ostatniej ramki
                    this.lastFrameTime[frameKey] = currentTime;

                    if (endpointId >= 1 && endpointId <= 3) {
                        // Aktualizuj stan capability
                        this.log("setting capability value on endpoint", endpointId, value);
                        this.setCapabilityValue(`onoff_${endpointId}`, value)
                            .catch(err => this.error(`Error setting capability value for onoff_${endpointId}:`, err));

                        // Wyzwól trigger
                        this.log(`triggering onoff_${endpointId}_${value ? 'true' : 'false'}`);
                        const triggerCard = this.homey.flow.getDeviceTriggerCard(`onoff_${endpointId}_${value ? 'true' : 'false'}`);
                        triggerCard.trigger(this)
                            .catch(err => this.error(`Error triggering onoff_${endpointId}_${value}:`, err));
                    } else { this.error("Unexpected endpoint for onoff frame:", endpointId, clusterId, frameData, meta)}
                } else if (firstByte === 1) {
                    const frameKey = `${endpointId}-${firstByte}-scene`; // Dla scen dodajemy stały suffix
                    
                    // Sprawdź czy minął czas debounce
                    if (this.lastFrameTime[frameKey] && 
                        (currentTime - this.lastFrameTime[frameKey]) < this.debounceTime) {
                        this.log('Debouncing frame:', frameKey);
                        return;
                    }
                    
                    // Aktualizuj czas ostatniej ramki
                    this.lastFrameTime[frameKey] = currentTime;

                    this.log("Received scene frame:", endpointId, clusterId, frameData, meta);
                    // Obsługa scen dla wszystkich endpointów
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
