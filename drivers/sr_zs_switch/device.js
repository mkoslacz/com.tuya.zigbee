'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class SRZSSwitch extends ZigBeeDevice {

    async onNodeInit({ zclNode }) {
        this.printNode();

      for (let i = 1; i <= 3; i++) {
        await this.configureAttributeReporting([
          {
            endpointId: i,
            cluster: CLUSTER.ON_OFF,
            attributeName: 'onOff',
            minInterval: 0,
            maxInterval: 300,
            minChange: 1
          }
        ]);

        this.registerCapability(`onoff_${i}`, CLUSTER.ON_OFF, {
          endpoint: i,
          get: 'onOff',
          getOpts: {},
          set: 'toggle',
          setParser: () => ({}),
          report: 'onOff',
          reportParser: value => value
        });
      }

      await this.magicallyConfigureTuyaSeparateOnoffSwitchingOnEndpoints(zclNode);
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

module.exports = SRZSSwitch;
