/** Supported wire protocols, not a verified catalog of provider model IDs. */
export const modelProtocols = [
  {id:'openai-completions',label:'OpenAI Chat 兼容',examples:'OpenAI、DeepSeek、OpenRouter、提供兼容接口的本地模型',baseUrl:'https://api.openai.com/v1'},
  {id:'openai-responses',label:'OpenAI Responses',examples:'提供 Responses 接口的模型服务',baseUrl:'https://api.openai.com/v1'},
  {id:'anthropic-messages',label:'Anthropic Messages',examples:'Claude 或兼容 Messages 的服务',baseUrl:'https://api.anthropic.com/v1'},
  {id:'google-generative-ai',label:'Google generateContent',examples:'Gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta'},
] as const;
export type ModelConnection={id:string;name:string;protocol:string;base_url:string;model_id:string;has_key:boolean};
export const modelProtocolLabel=(id:string)=>modelProtocols.find(p=>p.id===id)?.label??id;
