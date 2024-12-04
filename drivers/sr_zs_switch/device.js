'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class SRZSSwitch extends ZigBeeDevice {

    async onNodeInit({zclNode}) {
        this.printNode();

        // Przełącznik 1
        await this.configureAttributeReporting([
            {
                endpointId: 1,
                cluster: CLUSTER.ON_OFF,
                attributeName: 'onOff',
                minInterval: 0,
                maxInterval: 300,
                minChange: 1
            }
        ]);

        this.registerCapability('onoff_1', CLUSTER.ON_OFF, {
            endpoint: 1,
            get: 'onOff',
            getOpts: {},
            set: 'toggle',
            setParser: () => ({}),
            report: 'onOff',
            reportParser: value => value === 1
        });

        // Przełącznik 2
        await this.configureAttributeReporting([
            {
                endpointId: 2,
                cluster: CLUSTER.ON_OFF,
                attributeName: 'onOff',
                minInterval: 0,
                maxInterval: 300,
                minChange: 1
            }
        ]);

        this.registerCapability('onoff_2', CLUSTER.ON_OFF, {
            endpoint: 2,
            get: 'onOff',
            getOpts: {},
            set: 'toggle',
            setParser: () => ({}),
            report: 'onOff',
            reportParser: value => value === 1
        });

        // Przełącznik 3
        await this.configureAttributeReporting([
            {
                endpointId: 3,
                cluster: CLUSTER.ON_OFF,
                attributeName: 'onOff',
                minInterval: 0,
                maxInterval: 300,
                minChange: 1
            }
        ]);

        this.registerCapability('onoff_3', CLUSTER.ON_OFF, {
            endpoint: 3,
            get: 'onOff',
            getOpts: {},
            set: 'toggle',
            setParser: () => ({}),
            report: 'onOff',
            reportParser: value => value === 1
        });
    }
}

module.exports = SRZSSwitch; 