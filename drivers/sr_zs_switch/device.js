'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class SRZSSwitch extends ZigBeeDevice {

    async onNodeInit({zclNode}) {
        this.printNode();

        // Rejestracja listenerów
        this.registerCapabilityListener('onoff_1', async (value) => {
            return this.sendOnOffCommand(1, value);
        });
        
        this.registerCapabilityListener('onoff_2', async (value) => {
            return this.sendOnOffCommand(2, value);
        });
        
        this.registerCapabilityListener('onoff_3', async (value) => {
            return this.sendOnOffCommand(3, value);
        });

        // Nasłuchiwanie raportów
        for (let endpoint = 1; endpoint <= 3; endpoint++) {
            zclNode.endpoints[endpoint].clusters[CLUSTER.ON_OFF.NAME]
                .on('attr.onOff', value => {
                    this.handleReport(`onoff_${endpoint}`, value);
                });
        }
    }

    async sendOnOffCommand(endpoint, value) {
        try {
            const cluster = this.zclNode.endpoints[endpoint].clusters[CLUSTER.ON_OFF.NAME];
            
            if (value) {
                await cluster.on();
            } else {
                await cluster.off();
            }
            
            return value;
        } catch (error) {
            this.error(`Error sending command to endpoint ${endpoint}:`, error);
            throw error;
        }
    }

    async handleReport(capability, value) {
        try {
            const currentValue = await this.getCapabilityValue(capability);
            if (currentValue !== value) {
                await this.setCapabilityValue(capability, value);
            }
        } catch (error) {
            this.error('Error handling report:', error);
        }
    }
}

module.exports = SRZSSwitch; 