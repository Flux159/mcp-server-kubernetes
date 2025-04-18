import axios from "axios";

const URL = "http://lighthouse-api.g498.io/instances";

const payload = {
  requester: "kartik.mathur@snorkel.ai",
  version: "25.3.1",
  size: "0.25x_Standard",
  gpu: false,
  intention_type: "Internal",
  expiration_date: "2025-04-20"
};

const headers = {
  Authorization: "key bGlnaHRob3VzZSBhcGkga2V5IFNFRlVJU0VGSEVTSUZETlJKRzMzNDIK"
};

export const createLightHouseInstanceSchema = {
    name: "create_lighthouse_instance",
    description: "Create a new demo instance on Lighthouse",
    inputSchema: {
      type: "object",
      properties: {
        requester: {
          type: "string",
          description: "Email of the person requesting the instance",
        },
        version: {
          type: "string",
          description: "Version of the instance to create",
        },
        size: {
          type: "string",
          description: "Size of the instance (e.g., '0.25x_Standard')",
        },
        gpu: {
          type: "boolean",
          description: "Whether GPU is required",
        },
        intention_type: {
          type: "string",
          description: "Purpose of the instance (e.g., 'Internal')",
        },
        expiration_date: {
          type: "string",
          description: "Expiration date in YYYY-MM-DD format",
        },
      },
      required: ["requester", "version", "size", "intention_type", "expiration_date"],
    },
  };
  
  export async function createLightHouseInstance(params: typeof payload): Promise<{ content: { type: string; text: string }[] }> {
    try {
      const response = await axios.post(URL, params, { headers });
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "created",
              message: "Successfully created instance",
              data: response.data
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      throw new Error(`Failed to create instance: ${error.response?.data || error.message}`);
    }
  }