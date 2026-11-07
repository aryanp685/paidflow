import { startPrivateEmulator } from './emulator.mjs';
const {PAIDFLOW_STORAGE_LAB_DIR:directory,PAIDFLOW_STORAGE_LAB_ACCESS_KEY:accessKeyId,PAIDFLOW_STORAGE_LAB_SECRET_KEY:secretAccessKey,PAIDFLOW_STORAGE_LAB_EMULATOR_TOKEN:token,PAIDFLOW_STORAGE_LAB_PORT:portString}=process.env;
if(!directory||!portString)throw Error('Private local emulator directory and port are required');
const emulator=await startPrivateEmulator({directory,accessKeyId,secretAccessKey,token,port:Number(portString)});
console.log(`Guarded local test storage emulator listening on 127.0.0.1:${emulator.port}. Synthetic data only.`);
let closing=false;async function stop(){if(closing)return;closing=true;await emulator.close();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);
