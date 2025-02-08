'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class WallSwitch3GangButtons extends ZigBeeDevice {

    async onNodeInit({zclNode}) {
        this.printNode();
        await this.magicallyConfigureTuyaSeparateOnoffSwitchingOnEndpoints(zclNode);

        await this.registerSwitchCapabilities();
        await this.registerActionCards();
        await this.registerConditionCards();
        await this.registerTriggerCards();

        await this.checkAndConfigureIndicatorMode();
    }

    async registerSwitchCapabilities() {
        for (let endpoint = 1; endpoint <= 3; endpoint++) {
            await this.registerSingleSwitchCapability(endpoint);
        }
    }

    async registerSingleSwitchCapability(endpoint) {
        this.log(`Registering capability for endpoint ${endpoint}`);
        this.registerCapability(`onoff_${endpoint}`, CLUSTER.ON_OFF, {
            endpoint: endpoint,
            get: 'onOff',
            getOpts: {
                getOnStart: true,
                pollInterval: 300000
            },
            set: value => {
                this.log(`Setting endpoint ${endpoint} to ${value}`);
                return value ? 'setOn' : 'setOff';
            },
            setParser: () => {
                this.log(`SetParser called for endpoint ${endpoint}`);
                return {};
            },
            report: 'onOff',
            reportParser: async value => {
                this.log(`ReportParser called for endpoint ${endpoint} with value ${value}`);
                try {
                    this.log(`Triggering flow card for endpoint ${endpoint} with value ${value}`);
                    await this._switchTrigger.trigger(this, {
                        state: value
                    }, {
                        switch: endpoint.toString(),
                        state: value
                    }).catch(err => this.error('Error triggering switch_turned:', err));
                    this.log('Flow card triggered successfully');
                } catch (error) {
                    this.error('Error triggering flow card:', error);
                }
                return value;
            }
        });
    }


    async checkAndConfigureIndicatorMode() {
        try {
            const indicatorMode = await this.zclNode.endpoints[1].clusters.onOff.readAttributes(['indicatorMode']);     
            this.log("Indicator Mode supported by device");
            await this.setSettings({
                indicator_mode: indicatorMode.indicatorMode.toString()
            });
        } catch (error) {
            this.log("This device does not support Indicator Mode", error);
        }
    }

    async registerActionCards() {
        this.log('Registering action cards');
        this._actionCard = this.homey.flow.getActionCard('wall_switch_3_gang_buttons_set_state');
        this._actionCard
            .registerRunListener(async (args) => {
                const switchId = parseInt(args.switch);
                const state = args.state === 'true';
                this.log(`Action card triggered: switch ${switchId} to state ${state}`);
                try {
                    if (state) {
                        await args.device.zclNode.endpoints[switchId].clusters.onOff.setOn();
                    } else {
                        await args.device.zclNode.endpoints[switchId].clusters.onOff.setOff();
                    }
                    return true;
                } catch (error) {
                    this.error(`Error executing set_switch_state for switch ${switchId}:`, error);
                    return false;
                }
            });
    }

    async registerConditionCards() {
        this.log('Registering condition cards');
        this.homey.flow.getConditionCard('wall_switch_3_gang_buttons_is')
            .registerRunListener(async (args, state) => {
                const switchId = args.switch;
                this.log('Condition card triggered for switch:', args.switch);
                let currentValue;
                
                try {
                    currentValue = args.device.getCapabilityValue(`onoff_${switchId}`);
                    this.log('Current capability value:', currentValue);
                } catch (err) {
                    this.error('Error getting capability value in condition card:', err);
                    return false;
                }
                
                this.log('Condition card check:', {
                    switchId: switchId,
                    currentValue: currentValue,
                    state: state
                });
                
                return currentValue;
            });
    }

    async registerTriggerCards() {
        this.log('Registering trigger cards');
        this._switchTrigger = this.homey.flow.getDeviceTriggerCard('wall_switch_3_gang_buttons_state_changed');
        this._switchTrigger.registerRunListener(async (args, state) => {
            this.log('Trigger triggered:', args.switch, args.state);
            const result = args.switch === state.switch && args.state === state.state.toString();
            this.log('Trigger card result:', result);
            return result;
        });
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

    async onSettings({oldSettings, newSettings, changedKeys}) {
        if (changedKeys.includes('indicator_mode')) {
            const parsedValue = parseInt(newSettings.indicator_mode);
            await this.zclNode.endpoints[1].clusters.onOff.writeAttributes({ indicatorMode: parsedValue });
        }
    }

    onDeleted() {
        this.log('3 Gang Wall Switch removed');
    }
}

module.exports = WallSwitch3GangButtons; 